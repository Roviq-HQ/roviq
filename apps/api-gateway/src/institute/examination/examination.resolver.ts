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
  @CheckAbility('read', 'GradingScheme')
  gradingSchemes(
    @Args('kind', { type: () => String, nullable: true }) kind: GradingSchemeKind | null,
  ): Promise<GradingSchemeModel[]> {
    return this.config.listGradingSchemes(kind ?? undefined) as Promise<GradingSchemeModel[]>;
  }

  @Query(() => GradingSchemeModel, { description: 'A grade scheme with its bands.' })
  @CheckAbility('read', 'GradingScheme')
  async gradingScheme(@Args('id', { type: () => ID }) id: string): Promise<GradingSchemeModel> {
    const { scheme, bands } = await this.config.getGradingScheme(id);
    return { ...scheme, bands } as GradingSchemeModel;
  }

  @Mutation(() => GradingSchemeModel)
  @CheckAbility('manage', 'GradingScheme')
  createGradingScheme(@Args('input') input: CreateGradingSchemeInput): Promise<GradingSchemeModel> {
    const { bands, ...data } = input;
    return this.config.createGradingScheme(data, bands) as Promise<GradingSchemeModel>;
  }

  @Mutation(() => GradingSchemeModel)
  @CheckAbility('manage', 'GradingScheme')
  updateGradingScheme(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateGradingSchemeInput,
  ): Promise<GradingSchemeModel> {
    return this.config.updateGradingScheme(id, input) as Promise<GradingSchemeModel>;
  }

  @Mutation(() => [GradeBandModel])
  @CheckAbility('manage', 'GradingScheme')
  replaceGradeBands(@Args('input') input: ReplaceGradeBandsInput): Promise<GradeBandModel[]> {
    return this.config.replaceGradeBands(input.gradingSchemeId, input.bands) as Promise<
      GradeBandModel[]
    >;
  }

  @Mutation(() => Boolean)
  @CheckAbility('manage', 'GradingScheme')
  async deleteGradingScheme(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.config.deleteGradingScheme(id);
    return true;
  }

  // ── Exam terms ────────────────────────────────────────────────────────────

  @Query(() => [ExamTermModel])
  @CheckAbility('read', 'Exam')
  examTerms(
    @Args('academicYearId', { type: () => ID }) academicYearId: string,
  ): Promise<ExamTermModel[]> {
    return this.config.listExamTerms(academicYearId) as Promise<ExamTermModel[]>;
  }

  @Mutation(() => ExamTermModel)
  @CheckAbility('manage', 'Exam')
  createExamTerm(@Args('input') input: CreateExamTermInput): Promise<ExamTermModel> {
    return this.config.createExamTerm(input) as Promise<ExamTermModel>;
  }

  @Mutation(() => ExamTermModel)
  @CheckAbility('manage', 'Exam')
  updateExamTerm(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateExamTermInput,
  ): Promise<ExamTermModel> {
    return this.config.updateExamTerm(id, input) as Promise<ExamTermModel>;
  }

  @Mutation(() => Boolean)
  @CheckAbility('manage', 'Exam')
  async deleteExamTerm(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.config.deleteExamTerm(id);
    return true;
  }

  // ── Exams ─────────────────────────────────────────────────────────────────

  @Query(() => PaginatedExamsModel, { description: 'Paginated exams for an academic year.' })
  @CheckAbility('read', 'Exam')
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
  @CheckAbility('read', 'Exam')
  exam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.getExam(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility('create', 'Exam')
  createExam(@Args('input') input: CreateExamInput): Promise<ExamModel> {
    return this.exams.createExam(input) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility('update', 'Exam')
  updateExam(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateExamInput,
  ): Promise<ExamModel> {
    return this.exams.updateExam(id, input) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility('update', 'Exam')
  scheduleExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.scheduleExam(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility('update', 'Exam')
  openExamMarksEntry(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.openMarksEntry(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility('update', 'Exam')
  lockExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.lockExam(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility('update', 'Exam')
  publishExamResults(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.publishResults(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility('update', 'Exam')
  archiveExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.archiveExam(id) as Promise<ExamModel>;
  }

  @Mutation(() => ExamModel)
  @CheckAbility('update', 'Exam')
  unarchiveExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.unarchive(id) as Promise<ExamModel>;
  }

  @Mutation(() => Boolean)
  @CheckAbility('delete', 'Exam')
  async deleteExam(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.exams.delete(id);
    return true;
  }

  @Mutation(() => ExamModel)
  @CheckAbility('manage', 'Exam')
  restoreExam(@Args('id', { type: () => ID }) id: string): Promise<ExamModel> {
    return this.exams.restore(id) as Promise<ExamModel>;
  }

  // ── Datesheet ──────────────────────────────────────────────────────────────

  @Query(() => [ExamScheduleModel], { description: "An exam's datesheet rows." })
  @CheckAbility('read', 'Exam')
  examDatesheet(@Args('examId', { type: () => ID }) examId: string): Promise<ExamScheduleModel[]> {
    return this.exams.listSchedules(examId) as Promise<ExamScheduleModel[]>;
  }

  @Query(() => String, { description: 'Base64-encoded datesheet PDF.' })
  @CheckAbility('read', 'Exam')
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
  @CheckAbility('update', 'Exam')
  addExamSchedule(@Args('input') input: CreateExamScheduleInput): Promise<ExamScheduleModel> {
    return this.exams.addSchedule(input) as Promise<ExamScheduleModel>;
  }

  @Mutation(() => ExamScheduleModel)
  @CheckAbility('update', 'Exam')
  updateExamSchedule(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateExamScheduleInput,
  ): Promise<ExamScheduleModel> {
    return this.exams.updateSchedule(id, input) as Promise<ExamScheduleModel>;
  }

  @Mutation(() => Boolean)
  @CheckAbility('update', 'Exam')
  async removeExamSchedule(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.exams.removeSchedule(id);
    return true;
  }

  // ── Marks + results ──────────────────────────────────────────────────────

  @Query(() => MarksSheetModel, { description: 'Roster + existing marks for a datesheet row.' })
  @CheckAbility('read', 'Exam')
  examMarksSheet(
    @Args('examScheduleId', { type: () => ID }) examScheduleId: string,
  ): Promise<MarksSheetModel> {
    return this.marks.getMarksSheet(examScheduleId) as Promise<MarksSheetModel>;
  }

  @Mutation(() => Int, { description: 'Bulk-enter marks; returns the count saved.' })
  @CheckAbility('update', 'Exam')
  async enterExamMarks(@Args('input') input: EnterMarksInput): Promise<number> {
    const saved = await this.marks.enterMarks(input.examId, input.marks);
    return saved.length;
  }

  @Query(() => [StudentExamResultModel], {
    description: 'Computed results for an exam + section, with rank.',
  })
  @CheckAbility('read', 'Exam')
  examResults(
    @Args('examId', { type: () => ID }) examId: string,
    @Args('sectionId', { type: () => ID }) sectionId: string,
  ): Promise<StudentExamResultModel[]> {
    return this.marks.computeSectionResults(examId, sectionId) as Promise<StudentExamResultModel[]>;
  }
}
