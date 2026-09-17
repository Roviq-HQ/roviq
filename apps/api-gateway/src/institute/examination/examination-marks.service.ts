import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode, type ResultStatus } from '@roviq/common-types';
import {
  type ComponentMark,
  ExaminationGradingService,
  type GradeBandInput,
} from './examination-grading.service';
import { ExaminationRepository } from './repositories/examination.repository';
import type {
  CoScholasticAssessmentRecord,
  ExamMarkRecord,
  ExamRecord,
  ExamScheduleRecord,
  ExamTopicAssessmentRecord,
  GradeBandRecord,
  UpsertCoScholasticAssessmentData,
  UpsertExamMarkData,
  UpsertTopicAssessmentData,
} from './repositories/types';

/** One student's row in a marks sheet (existing mark merged onto the roster). */
export interface MarksSheetRow {
  studentId: string;
  studentProfileId: string;
  rollNumber: string | null;
  name: string;
  obtainedMarks: number | null;
  isAbsent: boolean;
  isExempted: boolean;
  remarks: string | null;
}

export interface MarksSheet {
  schedule: ExamScheduleRecord;
  rows: MarksSheetRow[];
}

export interface SubjectResultRow {
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  obtainedMarks: number;
  percentage: number;
  grade: string | null;
  gradePoint: number | null;
  isAbsent: boolean;
  isPassing: boolean;
}

export interface StudentExamResult {
  studentId: string;
  studentProfileId: string;
  rollNumber: string | null;
  name: string;
  subjects: SubjectResultRow[];
  maxMarks: number;
  obtainedMarks: number;
  percentage: number;
  gpa: number | null;
  resultStatus: ResultStatus;
  rank: number | null;
}

@Injectable()
export class ExaminationMarksService {
  constructor(
    private readonly repo: ExaminationRepository,
    private readonly grading: ExaminationGradingService,
  ) {}

  /** Roster + existing marks for one datesheet row (the marks-entry grid). */
  async getMarksSheet(examScheduleId: string): Promise<MarksSheet> {
    const schedule = await this.repo.findScheduleById(examScheduleId);
    if (!schedule) throw new BusinessException(ErrorCode.EXAM_NOT_FOUND, 'Schedule not found');
    const exam = await this.requireExam(schedule.examId);
    const [roster, marks] = await Promise.all([
      this.repo.listSectionRoster(schedule.sectionId, exam.academicYearId),
      this.repo.findMarksBySchedule(examScheduleId),
    ]);
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    const labels = await this.repo.resolveLabels({
      subjectIds: [],
      sectionIds: [],
      studentMembershipIds: roster.map((r) => r.membershipId),
      staffMembershipIds: [],
    });
    return {
      schedule,
      rows: roster.map((r) => {
        const mark = byStudent.get(r.membershipId);
        return {
          studentId: r.membershipId,
          studentProfileId: r.studentProfileId,
          rollNumber: r.rollNumber,
          name: labels.students[r.membershipId] ?? r.membershipId,
          obtainedMarks: numOrNull(mark?.obtainedMarks),
          isAbsent: mark?.isAbsent ?? false,
          isExempted: mark?.isExempted ?? false,
          remarks: mark?.remarks ?? null,
        };
      }),
    };
  }

  /**
   * Bulk-enter marks for an exam. Only allowed while the exam is in MARKS_ENTRY;
   * every mark is validated against its schedule's max (and non-negative).
   */
  async enterMarks(examId: string, marks: UpsertExamMarkData[]): Promise<ExamMarkRecord[]> {
    const exam = await this.requireExam(examId);
    if (exam.status !== 'MARKS_ENTRY') {
      throw new BusinessException(
        ErrorCode.EXAM_NOT_IN_MARKS_ENTRY,
        `Exam is ${exam.status}; open marks entry first`,
      );
    }
    const schedules = await this.repo.findSchedulesByExam(examId);
    const maxById = new Map(schedules.map((s) => [s.id, Number(s.maxMarks)]));
    for (const m of marks) {
      const max = maxById.get(m.examScheduleId);
      if (max === undefined) {
        throw new BusinessException(
          ErrorCode.EXAM_INVALID_CONFIG,
          'Schedule does not belong to this exam',
        );
      }
      if (m.obtainedMarks != null && (m.obtainedMarks < 0 || m.obtainedMarks > max)) {
        throw new BusinessException(
          ErrorCode.EXAM_MARKS_OUT_OF_RANGE,
          `Marks ${m.obtainedMarks} out of range 0–${max}`,
        );
      }
    }
    return this.repo.upsertMarks(marks);
  }

  /**
   * Compute the full result set for an exam + section: per-subject aggregation
   * (theory/practical/internal), grade from the exam's scheme, GPA, overall
   * pass/fail, and dense rank by aggregate percentage.
   */
  async computeSectionResults(examId: string, sectionId: string): Promise<StudentExamResult[]> {
    const exam = await this.requireExam(examId);
    const bands = await this.resolveBands(exam);

    const [schedules, marks, roster] = await Promise.all([
      this.repo.findSchedulesByExamSection(examId, sectionId),
      this.repo.findMarksByExamSection(examId, sectionId),
      this.repo.listSectionRoster(sectionId, exam.academicYearId),
    ]);

    const subjectIds = [...new Set(schedules.map((s) => s.subjectId))];
    const labels = await this.repo.resolveLabels({
      subjectIds,
      sectionIds: [],
      studentMembershipIds: roster.map((r) => r.membershipId),
      staffMembershipIds: [],
    });

    // (scheduleId, studentId) → mark
    const markIndex = new Map<string, ExamMarkRecord>();
    for (const m of marks) markIndex.set(`${m.examScheduleId}:${m.studentId}`, m);

    // subjectId → its schedule rows (components)
    const schedulesBySubject = new Map<string, ExamScheduleRecord[]>();
    for (const s of schedules) {
      const list = schedulesBySubject.get(s.subjectId) ?? [];
      list.push(s);
      schedulesBySubject.set(s.subjectId, list);
    }

    const results: StudentExamResult[] = roster.map((student) => {
      const subjects: SubjectResultRow[] = [...schedulesBySubject.entries()].map(
        ([subjectId, rows]) => {
          const components: ComponentMark[] = rows.map((row) => {
            const mark = markIndex.get(`${row.id}:${student.membershipId}`);
            return {
              maxMarks: Number(row.maxMarks),
              obtainedMarks: numOrNull(mark?.obtainedMarks),
              isAbsent: mark?.isAbsent ?? false,
              isExempted: mark?.isExempted ?? false,
            };
          });
          const r = this.grading.subjectResult(components, bands);
          return {
            subjectId,
            subjectName: labels.subjects[subjectId] ?? subjectId,
            maxMarks: r.maxMarks,
            obtainedMarks: r.obtainedMarks,
            percentage: r.percentage,
            grade: r.grade,
            gradePoint: r.gradePoint,
            isAbsent: r.isAbsent,
            isPassing: r.isPassing,
          };
        },
      );
      const maxMarks = subjects.reduce((s, x) => s + x.maxMarks, 0);
      const obtainedMarks = subjects.reduce((s, x) => s + x.obtainedMarks, 0);
      return {
        studentId: student.membershipId,
        studentProfileId: student.studentProfileId,
        rollNumber: student.rollNumber,
        name: labels.students[student.membershipId] ?? student.membershipId,
        subjects,
        maxMarks,
        obtainedMarks,
        percentage: this.grading.percentage(obtainedMarks, maxMarks),
        gpa: this.grading.gpa(subjects.map((s) => s.gradePoint)),
        resultStatus: this.grading.overallResult(subjects),
        rank: null,
      };
    });

    const ranks = this.grading.denseRank(
      results.map((r) => ({ id: r.studentId, value: r.percentage })),
    );
    for (const r of results) r.rank = ranks.get(r.studentId) ?? null;
    results.sort((a, b) => b.percentage - a.percentage);
    return results;
  }

  /** Bulk-enter NEP topic-wise competency assessments. */
  upsertTopicAssessments(data: UpsertTopicAssessmentData[]): Promise<ExamTopicAssessmentRecord[]> {
    return this.repo.upsertTopicAssessments(data);
  }

  /** Bulk-enter co-scholastic grades for a term. */
  upsertCoScholasticAssessments(
    data: UpsertCoScholasticAssessmentData[],
  ): Promise<CoScholasticAssessmentRecord[]> {
    return this.repo.upsertCoScholasticAssessments(data);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async requireExam(examId: string): Promise<ExamRecord> {
    const exam = await this.repo.findExamById(examId);
    if (!exam) throw new BusinessException(ErrorCode.EXAM_NOT_FOUND, `Exam ${examId} not found`);
    return exam;
  }

  /** Resolve the exam's grade bands: its scheme, else the default SCHOLASTIC scheme. */
  private async resolveBands(exam: ExamRecord): Promise<GradeBandInput[]> {
    let schemeId = exam.gradingSchemeId;
    if (!schemeId) {
      const def = await this.repo.findDefaultScheme('SCHOLASTIC');
      schemeId = def?.id ?? null;
    }
    if (!schemeId) return [];
    return toBandInputs(await this.repo.findBands(schemeId));
  }
}

function numOrNull(v: number | null | undefined): number | null {
  return v ?? null;
}

function toBandInputs(bands: GradeBandRecord[]): GradeBandInput[] {
  return bands.map((b) => ({
    grade: b.grade,
    minPercent: numOrNull(b.minPercent),
    maxPercent: numOrNull(b.maxPercent),
    gradePoint: numOrNull(b.gradePoint),
    isPassing: b.isPassing,
    descriptor: b.descriptor,
  }));
}
