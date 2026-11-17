import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { ExamStatus, type GradingSchemeKind } from '@roviq/common-types';
import {
  CreateExamInput,
  CreateExamScheduleInput,
  CreateExamTermInput,
  CreateGradingSchemeInput,
  EnterMarksInput,
  ReplaceGradeBandsInput,
  UpdateExamInput,
  UpdateExamScheduleInput,
  UpdateExamTermInput,
  UpdateGradingSchemeInput,
} from './dto/examination.inputs';
import { ExaminationService } from './examination.service';
import { ExaminationConfigService } from './examination-config.service';
import { ExaminationDatesheetPdfService } from './examination-datesheet-pdf.service';
import { ExaminationMarksService } from './examination-marks.service';
import {
  ExamModel,
  ExamScheduleModel,
  ExamTermModel,
  GradeBandModel,
  GradingSchemeModel,
  MarksSheetModel,
  PaginatedExamsModel,
  StudentExamResultModel,
} from './models/examination.model';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class ExaminationResolver {
  constructor(
    private readonly config: ExaminationConfigService,
    private readonly exams: ExaminationService,
    private readonly marks: ExaminationMarksService,
    private readonly datesheetPdf: ExaminationDatesheetPdfService,
  ) {}

  // ── Grading schemes ──────────────────────────────────────────────────────

  @Query(() => [GradingSchemeModel], { description: 'List grade schemes (optionally by kind).' })
  @CheckAbility({ action: 'read', subject: 'GradingScheme' })
  gradingSchemes(
    @Args('kind', { type: () => String, nullable: true }) kind: GradingSchemeKind | null,
  ): Promise<GradingSchemeModel[]> {
    return this.config.listGradingSchemes(kind ?? undefined) as Promise<GradingSchemeModel[]>;
  }

  @Query(() => GradingSchemeModel, { description: 'A grade scheme with its bands.' })
  @CheckAbility({ action: 'read', subject: 'GradingScheme' })
  async gradingScheme(@Args('id', { type: () => ID }) id: string): Promise<GradingSchemeModel> {
    const { scheme, bands } = await this.config.getGradingScheme(id);
    return { ...scheme, bands } as GradingSchemeModel;
  }

  @Mutation(() => GradingSchemeModel)
  @CheckAbility({ action: 'manage', subject: 'GradingScheme' })
  createGradingScheme(@Args('input') input: CreateGradingSchemeInput): Promise<GradingSchemeModel> {
    const { bands, ...data } = input;
    return this.config.createGradingScheme(data, bands) as Promise<GradingSchemeModel>;
  }

  @Mutation(() => GradingSchemeModel)
  @CheckAbility({ action: 'manage', subject: 'GradingScheme' })
  updateGradingScheme(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateGradingSchemeInput,
  ): Promise<GradingSchemeModel> {
    return this.config.updateGradingScheme(id, input) as Promise<GradingSchemeModel>;
  }

  @Mutation(() => [GradeBandModel])
  @CheckAbility({ action: 'manage', subject: 'GradingScheme' })
  replaceGradeBands(@Args('input') input: ReplaceGradeBandsInput): Promise<GradeBandModel[]> {
    return this.config.replaceGradeBands(input.gradingSchemeId, input.bands) as Promise<
      GradeBandModel[]
    >;
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'manage', subject: 'GradingScheme' })
  async deleteGradingScheme(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.config.deleteGradingScheme(id);
    return true;
  }

  // ── Exam terms ────────────────────────────────────────────────────────────

  @Query(() => [ExamTermModel])
  @CheckAbility({ action: 'read', subject: 'Exam' })
  examTerms(
    @Args('academicYearId', { type: () => ID }) academicYearId: string,
  ): Promise<ExamTermModel[]> {
    return this.config.listExamTerms(academicYearId) as Promise<ExamTermModel[]>;
  }

  @Mutation(() => ExamTermModel)
  @CheckAbility({ action: 'manage', subject: 'Exam' })
  createExamTerm(@Args('input') input: CreateExamTermInput): Promise<ExamTermModel> {
    return this.config.createExamTerm(input) as Promise<ExamTermModel>;
  }

  @Mutation(() => ExamTermModel)
  @CheckAbility({ action: 'manage', subject: 'Exam' })
  updateExamTerm(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateExamTermInput,
  ): Promise<ExamTermModel> {
    return this.config.updateExamTerm(id, input) as Promise<ExamTermModel>;
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'manage', subject: 'Exam' })
  async deleteExamTerm(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.config.deleteExamTerm(id);
    return true;
  }

  // ── Exams ─────────────────────────────────────────────────────────────────

  @Query(() => PaginatedExamsModel, { description: 'Paginated exams for an academic year.' })
  @CheckAbility({ action: 'read', subject: 'Exam' })
  examsList(
    @Args('academicYearId', { type: () => ID }) academicYearId: string,
    @Args('examTermId', { type: () => ID, nullable: true }) examTermId: string | null,
    @Args('status', { type: () => ExamStatus, nullable: true }) status: ExamStatus | null,
    @Args('sectionId', { type: () => ID, nullable: true }) sectionId: string | null,
    @Args('search', { type: () => String, nullable: true }) search: string | null,
    @Args('page', { type: () => Int, nullable: true }) page: number | null,
    @Args('perPage', { type: () => Int, nullable: true }) perPage: number | null,
  ): Promise<PaginatedExamsModel> {
    return this.exams.listExams({
      academicYearId,
      examTermId: examTermId ?? undefined,
      status: status ?? undefined,
      sectionId: sectionId ?? undefined,
      search: search ?? undefined,
      page: page ?? 1,
      perPage: perPage ?? 20,
    }) as Promise<PaginatedExamsModel>;
  }

  @Query(() => ExamModel)
  @CheckAbility({ action: 'read', subject: 'Exam' })
  exam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.getExam(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility({ action: 'create', subject: 'Exam' })
  createExam(@Args('input') input: CreateExamInput): Promise<ExamModel> {
    return this.exams.createExam(input) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  updateExam(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateExamInput,
  ): Promise<ExamModel> {
    return this.exams.updateExam(id, input) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  scheduleExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.scheduleExam(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  openExamMarksEntry(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.openMarksEntry(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  lockExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.lockExam(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  publishExamResults(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.publishResults(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  archiveExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.archiveExam(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  unarchiveExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.unarchive(id) as Promise<ExamModel>;
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'delete', subject: 'Exam' })
  async deleteExam(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.exams.delete(id);
    return true;
  }

  @Mutation(() => ExamModel)
  @CheckAbility({ action: 'manage', subject: 'Exam' })
  restoreExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.restore(id) as Promise<ExamModel>;
  }

  // ── Datesheet ──────────────────────────────────────────────────────────────

  @Query(() => [ExamScheduleModel], { description: "An exam's datesheet rows." })
  @CheckAbility({ action: 'read', subject: 'Exam' })
  examDatesheet(@Args('examId', { type: () => ID }) examId: string): Promise<ExamScheduleModel[]> {
    return this.exams.listSchedules(examId) as Promise<ExamScheduleModel[]>;
  }

  @Query(() => String, { description: 'Base64-encoded datesheet PDF.' })
  @CheckAbility({ action: 'read', subject: 'Exam' })
  async examDatesheetPdf(
    @Args('examId', { type: () => ID }) examId: string,
    @Args('sectionId', { type: () => ID, nullable: true, description: 'Filter to one section.' })
    sectionId: string | null,
    @Args('staffId', {
      type: () => ID,
      nullable: true,
      description: "Render one invigilator's duty roster.",
    })
    staffId: string | null,
  ): Promise<string> {
    return (
      await this.datesheetPdf.render(examId, sectionId ?? undefined, staffId ?? undefined)
    ).toString('base64');
  }

  @Mutation(() => ExamScheduleModel)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  addExamSchedule(@Args('input') input: CreateExamScheduleInput): Promise<ExamScheduleModel> {
    return this.exams.addSchedule(input) as Promise<ExamScheduleModel>;
  }

  @Mutation(() => ExamScheduleModel)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  updateExamSchedule(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateExamScheduleInput,
  ): Promise<ExamScheduleModel> {
    return this.exams.updateSchedule(id, input) as Promise<ExamScheduleModel>;
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'update', subject: 'Exam' })
  async removeExamSchedule(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.exams.removeSchedule(id);
    return true;
  }

  // ── Marks + results ──────────────────────────────────────────────────────

  @Query(() => MarksSheetModel, { description: 'Roster + existing marks for a datesheet row.' })
  @CheckAbility({ action: 'read', subject: 'Exam' })
  examMarksSheet(
    @Args('examScheduleId', { type: () => ID }) examScheduleId: string,
  ): Promise<MarksSheetModel> {
    return this.marks.getMarksSheet(examScheduleId) as Promise<MarksSheetModel>;
  }

  @Mutation(() => Int, { description: 'Bulk-enter marks; returns the count saved.' })
  @CheckAbility({ action: 'update', subject: 'Exam' })
  async enterExamMarks(@Args('input') input: EnterMarksInput): Promise<number> {
    const saved = await this.marks.enterMarks(input.examId, input.marks);
    return saved.length;
  }

  @Query(() => [StudentExamResultModel], {
    description: 'Computed results for an exam + section, with rank.',
  })
  @CheckAbility({ action: 'read', subject: 'Exam' })
  examResults(
    @Args('examId', { type: () => ID }) examId: string,
    @Args('sectionId', { type: () => ID }) sectionId: string,
  ): Promise<StudentExamResultModel[]> {
    return this.marks.computeSectionResults(examId, sectionId) as Promise<StudentExamResultModel[]>;
  }
}
