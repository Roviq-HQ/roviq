import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessException, ErrorCode, type GradingSchemeKind } from '@roviq/common-types';
import { ExaminationGradingService, type GradeBandInput } from './examination-grading.service';
import { ExaminationRepository } from './repositories/examination.repository';
import type {
  CoScholasticAreaRecord,
  CreateCoScholasticAreaData,
  CreateExamTermData,
  CreateGradingSchemeData,
  CreateSubjectTopicData,
  ExamTermRecord,
  GradeBandData,
  GradeBandRecord,
  GradingSchemeRecord,
  SubjectTopicRecord,
} from './repositories/types';

/** Grade schemes, grade bands, and exam terms — the configuration layer. */
@Injectable()
export class ExaminationConfigService {
  constructor(
    private readonly repo: ExaminationRepository,
    private readonly grading: ExaminationGradingService,
  ) {}

  // ── Grading schemes ──────────────────────────────────────────────────────

  async createGradingScheme(
    data: CreateGradingSchemeData,
    bands: GradeBandData[],
  ): Promise<GradingSchemeRecord> {
    if (data.kind === 'SCHOLASTIC') this.grading.assertValidScholasticBands(toBandInputs(bands));
    return this.repo.createGradingScheme(data, bands);
  }

  updateGradingScheme(
    id: string,
    data: Partial<CreateGradingSchemeData>,
  ): Promise<GradingSchemeRecord> {
    return this.repo.updateGradingScheme(id, data);
  }

  async replaceGradeBands(
    gradingSchemeId: string,
    bands: GradeBandData[],
  ): Promise<GradeBandRecord[]> {
    const scheme = await this.repo.findGradingSchemeById(gradingSchemeId);
    if (!scheme)
      throw new BusinessException(ErrorCode.GRADING_SCHEME_NOT_FOUND, 'Scheme not found');
    if (scheme.kind === 'SCHOLASTIC') this.grading.assertValidScholasticBands(toBandInputs(bands));
    return this.repo.replaceBands(gradingSchemeId, bands);
  }

  listGradingSchemes(kind?: GradingSchemeKind): Promise<GradingSchemeRecord[]> {
    return this.repo.listGradingSchemes(kind);
  }

  async getGradingScheme(
    id: string,
  ): Promise<{ scheme: GradingSchemeRecord; bands: GradeBandRecord[] }> {
    const scheme = await this.repo.findGradingSchemeById(id);
    if (!scheme)
      throw new BusinessException(ErrorCode.GRADING_SCHEME_NOT_FOUND, 'Scheme not found');
    const bands = await this.repo.findBands(id);
    return { scheme, bands };
  }

  findBands(gradingSchemeId: string): Promise<GradeBandRecord[]> {
    return this.repo.findBands(gradingSchemeId);
  }

  async deleteGradingScheme(id: string): Promise<void> {
    const refs = await this.repo.countSchemeReferences(id);
    if (refs > 0) {
      throw new BusinessException(
        ErrorCode.GRADING_SCHEME_IN_USE,
        `Grading scheme is referenced by ${refs} record(s)`,
      );
    }
    await this.repo.softDeleteGradingScheme(id);
  }

  // ── Exam terms ────────────────────────────────────────────────────────────

  createExamTerm(data: CreateExamTermData): Promise<ExamTermRecord> {
    return this.repo.createExamTerm(data);
  }

  updateExamTerm(id: string, data: Partial<CreateExamTermData>): Promise<ExamTermRecord> {
    return this.repo.updateExamTerm(id, data);
  }

  listExamTerms(academicYearId: string): Promise<ExamTermRecord[]> {
    return this.repo.listExamTerms(academicYearId);
  }

  async getExamTerm(id: string): Promise<ExamTermRecord> {
    const term = await this.repo.findExamTermById(id);
    if (!term) throw new NotFoundException(`Exam term ${id} not found`);
    return term;
  }

  deleteExamTerm(id: string): Promise<void> {
    return this.repo.softDeleteExamTerm(id);
  }

  // ── NEP subject topics ──────────────────────────────────────────────────────

  createSubjectTopic(data: CreateSubjectTopicData): Promise<SubjectTopicRecord> {
    return this.repo.createSubjectTopic(data);
  }

  listSubjectTopics(subjectId: string, standardId?: string): Promise<SubjectTopicRecord[]> {
    return this.repo.listSubjectTopics(subjectId, standardId);
  }

  deleteSubjectTopic(id: string): Promise<void> {
    return this.repo.softDeleteSubjectTopic(id);
  }

  // ── Co-scholastic areas ──────────────────────────────────────────────────────

  createCoScholasticArea(data: CreateCoScholasticAreaData): Promise<CoScholasticAreaRecord> {
    return this.repo.createCoScholasticArea(data);
  }

  listCoScholasticAreas(): Promise<CoScholasticAreaRecord[]> {
    return this.repo.listCoScholasticAreas();
  }

  deleteCoScholasticArea(id: string): Promise<void> {
    return this.repo.softDeleteCoScholasticArea(id);
  }
}

/** GradeBandData (input) → GradeBandInput (grading-service shape). */
function toBandInputs(bands: GradeBandData[]): GradeBandInput[] {
  return bands.map((b) => ({
    grade: b.grade,
    minPercent: b.minPercent ?? null,
    maxPercent: b.maxPercent ?? null,
    gradePoint: b.gradePoint ?? null,
    isPassing: b.isPassing ?? true,
    descriptor: b.descriptor ?? null,
  }));
}
