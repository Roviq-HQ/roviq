import { Injectable } from '@nestjs/common';
import {
  BusinessException,
  ErrorCode,
  REPORT_CARD_STATE_MACHINE,
  type ResultStatus,
} from '@roviq/common-types';
import { i18nDisplay } from '@roviq/database';
import {
  ExaminationGradingService,
  type GradeBandInput,
  round2,
} from './examination-grading.service';
import { ExaminationMarksService } from './examination-marks.service';
import { ExaminationRepository } from './repositories/examination.repository';
import type {
  GradeBandRecord,
  ReportCardInstanceRecord,
  ReportCardRecord,
  UpsertReportCardInstanceData,
} from './repositories/types';

interface SubjectLine {
  subjectId: string;
  subjectName: string;
  percentage: number;
  grade: string | null;
  gradePoint: number | null;
  isAbsent: boolean;
  isPassing: boolean;
  exams: Array<{ examName: string; percentage: number; weight: number }>;
  topics: Array<{ name: string; competency: string; descriptor: string | null }>;
}

interface CoScholasticLine {
  area: string;
  grade: string;
  descriptor: string | null;
}

/**
 * The immutable snapshot persisted on `report_card_instances.payload`.
 * The index signature lets it round-trip through the jsonb `Record<string, unknown>`
 * column without an `as unknown` cast at either boundary.
 */
export interface ReportCardPayload {
  [key: string]: unknown;
  termName: string | null;
  student: { name: string; rollNumber: string | null };
  subjects: SubjectLine[];
  coScholastic: CoScholasticLine[];
}

/**
 * Builds per-student report cards for a section by aggregating every exam in
 * the card's term (weighted by `weightInTerm`), grading the aggregate, pulling
 * attendance %, NEP topic-wise competency, and co-scholastic grades into one
 * persisted snapshot. Re-runnable (upsert).
 */
@Injectable()
export class ReportCardGenerationService {
  constructor(
    private readonly repo: ExaminationRepository,
    private readonly marks: ExaminationMarksService,
    private readonly grading: ExaminationGradingService,
  ) {}

  async generate(reportCardId: string, sectionId: string): Promise<ReportCardInstanceRecord[]> {
    const card = await this.requireCard(reportCardId);
    if (!card.examTermId) {
      throw new BusinessException(
        ErrorCode.REPORT_CARD_GENERATION_FAILED,
        'Report card must target a term to aggregate exams',
      );
    }
    const bands = await this.resolveBands(card);
    const term = await this.repo.findExamTermById(card.examTermId);
    const exams = (await this.repo.listExamsInTerm(card.examTermId)).filter(
      (e) => e.status !== 'DRAFT' && e.status !== 'ARCHIVED',
    );
    const roster = await this.repo.listSectionRoster(sectionId, card.academicYearId);
    if (roster.length === 0) {
      throw new BusinessException(
        ErrorCode.REPORT_CARD_GENERATION_FAILED,
        'No students enrolled in this section',
      );
    }

    // exam → student membership → subjectId → { percentage, isAbsent }
    const perExam = new Map<
      string,
      { name: string; weight: number; byStudent: Map<string, Map<string, SubjectResultLite>> }
    >();
    const subjectNames = new Map<string, string>();
    for (const exam of exams) {
      const results = await this.marks.computeSectionResults(exam.id, sectionId);
      const byStudent = new Map<string, Map<string, SubjectResultLite>>();
      for (const r of results) {
        const subjects = new Map<string, SubjectResultLite>();
        for (const s of r.subjects) {
          subjects.set(s.subjectId, { percentage: s.percentage, isAbsent: s.isAbsent });
          subjectNames.set(s.subjectId, s.subjectName);
        }
        byStudent.set(r.studentId, subjects);
      }
      perExam.set(exam.id, {
        name: i18nDisplay(exam.name),
        weight: Number(exam.weightInTerm),
        byStudent,
      });
    }
    const subjectIds = [...subjectNames.keys()];

    const topicsByStudent = card.includeTopicWise
      ? await this.collectTopics(
          exams.map((e) => e.id),
          sectionId,
          subjectIds,
        )
      : new Map<string, Map<string, SubjectLine['topics']>>();
    const coScholasticByStudent = card.includeCoScholastic
      ? await this.collectCoScholastic(card.examTermId)
      : new Map<string, CoScholasticLine[]>();
    const termSpan = examSpan(exams);

    // Build each student's computed card.
    const computed: UpsertReportCardInstanceData[] = await Promise.all(
      roster.map(async (student) => {
        const subjects: SubjectLine[] = subjectIds.map((subjectId) => {
          const examPercents = exams.map((e) => {
            const cell = perExam.get(e.id)?.byStudent.get(student.membershipId)?.get(subjectId);
            return {
              percentage: cell?.percentage ?? 0,
              weight: perExam.get(e.id)?.weight ?? 0,
              isAbsent: cell?.isAbsent ?? true,
            };
          });
          const agg = this.grading.weightedTermPercentage(examPercents);
          const band = agg.isAbsent ? null : this.grading.gradeForPercent(bands, agg.percentage);
          return {
            subjectId,
            subjectName: subjectNames.get(subjectId) ?? subjectId,
            percentage: agg.percentage,
            grade: band?.grade ?? null,
            gradePoint: band?.gradePoint ?? null,
            isAbsent: agg.isAbsent,
            isPassing: band?.isPassing ?? false,
            exams: examPercents
              .map((p, i) => ({
                examName: perExam.get(exams[i].id)?.name ?? '',
                percentage: p.percentage,
                weight: p.weight,
              }))
              .filter((e) => e.weight > 0),
            topics: topicsByStudent.get(student.membershipId)?.get(subjectId) ?? [],
          };
        });

        const overallPct =
          subjects.length === 0
            ? 0
            : round2(subjects.reduce((s, x) => s + x.percentage, 0) / subjects.length);
        const overallBand = this.grading.gradeForPercent(bands, overallPct);
        const resultStatus: ResultStatus = this.grading.overallResult(subjects);

        let attendancePercent: number | null = null;
        if (card.includeAttendance && termSpan) {
          const tally = await this.repo.attendanceTally(
            student.membershipId,
            card.academicYearId,
            termSpan.from,
            termSpan.to,
          );
          attendancePercent = tally.total > 0 ? round2((tally.present / tally.total) * 100) : null;
        }

        const studentName =
          `${i18nDisplay(student.firstName)} ${i18nDisplay(student.lastName ?? {})}`.trim();
        const payload: ReportCardPayload = {
          termName: term ? i18nDisplay(term.name) : null,
          student: { name: studentName, rollNumber: student.rollNumber },
          subjects,
          coScholastic: coScholasticByStudent.get(student.membershipId) ?? [],
        };

        return {
          reportCardId,
          studentProfileId: student.studentProfileId,
          sectionId,
          academicYearId: card.academicYearId,
          maxMarks: null,
          obtainedMarks: null,
          percentage: overallPct,
          gpa: this.grading.gpa(subjects.map((s) => s.gradePoint)),
          grade: overallBand?.grade ?? null,
          rank: null,
          attendancePercent,
          resultStatus,
          payload,
        };
      }),
    );

    // Dense rank by overall percentage.
    const ranks = this.grading.denseRank(
      computed.map((c) => ({ id: c.studentProfileId, value: c.percentage ?? 0 })),
    );
    for (const c of computed) c.rank = ranks.get(c.studentProfileId) ?? null;

    const instances = await this.repo.upsertReportCardInstances(computed);
    if (card.status === 'DRAFT') {
      REPORT_CARD_STATE_MACHINE.assertTransition(card.status, 'GENERATED');
      await this.repo.setReportCardStatus(reportCardId, 'GENERATED');
    }
    return instances;
  }

  async publish(reportCardId: string): Promise<number> {
    const card = await this.requireCard(reportCardId);
    REPORT_CARD_STATE_MACHINE.assertTransition(card.status, 'PUBLISHED');
    const count = await this.repo.publishReportCardInstances(reportCardId);
    await this.repo.setReportCardStatus(reportCardId, 'PUBLISHED');
    return count;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async requireCard(id: string): Promise<ReportCardRecord> {
    const card = await this.repo.findReportCardById(id);
    if (!card) throw new BusinessException(ErrorCode.REPORT_CARD_NOT_FOUND, `Report card ${id}`);
    return card;
  }

  private async resolveBands(card: ReportCardRecord): Promise<GradeBandInput[]> {
    let schemeId = card.gradingSchemeId;
    if (!schemeId) {
      const def = await this.repo.findDefaultScheme('SCHOLASTIC');
      schemeId = def?.id ?? null;
    }
    if (!schemeId) return [];
    return toBandInputs(await this.repo.findBands(schemeId));
  }

  /** membership id → subjectId → topic lines (latest exam in the term wins). */
  private async collectTopics(
    examIds: string[],
    sectionId: string,
    subjectIds: string[],
  ): Promise<Map<string, Map<string, SubjectLine['topics']>>> {
    const topicMeta = new Map<string, { name: string; subjectId: string }>();
    for (const t of await this.repo.listSubjectTopicsForSubjects(subjectIds)) {
      topicMeta.set(t.id, { name: i18nDisplay(t.name), subjectId: t.subjectId });
    }
    const out = new Map<string, Map<string, SubjectLine['topics']>>();
    for (const examId of examIds) {
      const assessments = await this.repo.findTopicAssessmentsByExamSection(examId, sectionId);
      for (const a of assessments) {
        const meta = topicMeta.get(a.subjectTopicId);
        if (!meta) continue;
        const bySubject = out.get(a.studentId) ?? new Map<string, SubjectLine['topics']>();
        const lines = bySubject.get(meta.subjectId) ?? [];
        const existing = lines.find((l) => l.name === meta.name);
        const line = { name: meta.name, competency: a.competencyLevel, descriptor: a.descriptor };
        if (existing) Object.assign(existing, line);
        else lines.push(line);
        bySubject.set(meta.subjectId, lines);
        out.set(a.studentId, bySubject);
      }
    }
    return out;
  }

  private async collectCoScholastic(examTermId: string): Promise<Map<string, CoScholasticLine[]>> {
    const areaNames = new Map<string, string>();
    for (const a of await this.repo.listCoScholasticAreas())
      areaNames.set(a.id, i18nDisplay(a.name));
    const out = new Map<string, CoScholasticLine[]>();
    for (const a of await this.repo.findCoScholasticAssessments(examTermId)) {
      const lines = out.get(a.studentId) ?? [];
      lines.push({
        area: areaNames.get(a.coScholasticAreaId) ?? '',
        grade: a.grade,
        descriptor: a.descriptor,
      });
      out.set(a.studentId, lines);
    }
    return out;
  }
}

interface SubjectResultLite {
  percentage: number;
  isAbsent: boolean;
}

function toBandInputs(bands: GradeBandRecord[]): GradeBandInput[] {
  return bands.map((b) => ({
    grade: b.grade,
    minPercent: b.minPercent ?? null,
    maxPercent: b.maxPercent ?? null,
    gradePoint: b.gradePoint ?? null,
    isPassing: b.isPassing,
    descriptor: b.descriptor,
  }));
}

/** min(startDate)..max(endDate) across exams, for the attendance window. */
function examSpan(
  exams: Array<{ startDate: string | null; endDate: string | null }>,
): { from: string; to: string } | null {
  const starts = exams.map((e) => e.startDate).filter((d): d is string => !!d);
  const ends = exams.map((e) => e.endDate ?? e.startDate).filter((d): d is string => !!d);
  if (starts.length === 0 || ends.length === 0) return null;
  return { from: starts.sort()[0], to: ends.sort().at(-1) as string };
}
