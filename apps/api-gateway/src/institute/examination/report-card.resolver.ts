import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import {
  CreateCoScholasticAreaInput,
  CreateReportCardInput,
  CreateSubjectTopicInput,
  EnterCoScholasticInput,
  EnterTopicAssessmentsInput,
  UpdateReportCardInput,
} from './dto/examination.inputs';
import { ExaminationConfigService } from './examination-config.service';
import { ExaminationMarksService } from './examination-marks.service';
import {
  CoScholasticAreaModel,
  ReportCardInstanceModel,
  ReportCardModel,
  SubjectTopicModel,
} from './models/examination.model';
import { ReportCardService } from './report-card.service';
import { ReportCardPdfService } from './report-card-pdf.service';
import type { ReportCardInstanceRecord } from './repositories/types';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class ReportCardResolver {
  constructor(
    private readonly config: ExaminationConfigService,
    private readonly marks: ExaminationMarksService,
    private readonly cards: ReportCardService,
    private readonly pdf: ReportCardPdfService,
  ) {}

  // ── NEP subject topics ──────────────────────────────────────────────────────

  @Query(() => [SubjectTopicModel], { description: 'NEP topics for a subject.' })
  @CheckAbility('read', 'Exam')
  subjectTopics(
    @Args('subjectId', { type: () => ID }) subjectId: string,
    @Args('standardId', { type: () => ID, nullable: true }) standardId: string | null,
  ): Promise<SubjectTopicModel[]> {
    return this.config.listSubjectTopics(subjectId, standardId ?? undefined) as Promise<
      SubjectTopicModel[]
    >;
  }

  @Mutation(() => SubjectTopicModel)
  @CheckAbility('manage', 'Exam')
  createSubjectTopic(@Args('input') input: CreateSubjectTopicInput): Promise<SubjectTopicModel> {
    return this.config.createSubjectTopic(input) as Promise<SubjectTopicModel>;
  }

  @Mutation(() => Boolean)
  @CheckAbility('manage', 'Exam')
  async deleteSubjectTopic(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.config.deleteSubjectTopic(id);
    return true;
  }

  @Mutation(() => Int, { description: 'Bulk-enter NEP topic competency assessments.' })
  @CheckAbility('update', 'Exam')
  async enterTopicAssessments(@Args('input') input: EnterTopicAssessmentsInput): Promise<number> {
    const saved = await this.marks.upsertTopicAssessments(input.assessments);
    return saved.length;
  }

  // ── Co-scholastic ────────────────────────────────────────────────────────────

  @Query(() => [CoScholasticAreaModel])
  @CheckAbility('read', 'Exam')
  coScholasticAreas(): Promise<CoScholasticAreaModel[]> {
    return this.config.listCoScholasticAreas() as Promise<CoScholasticAreaModel[]>;
  }

  @Mutation(() => CoScholasticAreaModel)
  @CheckAbility('manage', 'Exam')
  createCoScholasticArea(
    @Args('input') input: CreateCoScholasticAreaInput,
  ): Promise<CoScholasticAreaModel> {
    return this.config.createCoScholasticArea(input) as Promise<CoScholasticAreaModel>;
  }

  @Mutation(() => Boolean)
  @CheckAbility('manage', 'Exam')
  async deleteCoScholasticArea(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.config.deleteCoScholasticArea(id);
    return true;
  }

  @Mutation(() => Int)
  @CheckAbility('update', 'Exam')
  async enterCoScholasticAssessments(
    @Args('input') input: EnterCoScholasticInput,
  ): Promise<number> {
    const saved = await this.marks.upsertCoScholasticAssessments(input.assessments);
    return saved.length;
  }

  // ── Report cards ─────────────────────────────────────────────────────────────

  @Query(() => [ReportCardModel])
  @CheckAbility('read', 'ReportCard')
  reportCards(
    @Args('academicYearId', { type: () => ID }) academicYearId: string,
  ): Promise<ReportCardModel[]> {
    return this.cards.listReportCards(academicYearId) as Promise<ReportCardModel[]>;
  }

  @Query(() => ReportCardModel)
  @CheckAbility('read', 'ReportCard')
  reportCard(@Args('id', { type: () => ID }) id: string): Promise<ReportCardModel> {
    return this.cards.getReportCard(id) as Promise<ReportCardModel>;
  }

  @Mutation(() => ReportCardModel)
  @CheckAbility('manage', 'ReportCard')
  createReportCard(@Args('input') input: CreateReportCardInput): Promise<ReportCardModel> {
    return this.cards.createReportCard(input) as Promise<ReportCardModel>;
  }

  @Mutation(() => ReportCardModel)
  @CheckAbility('manage', 'ReportCard')
  updateReportCard(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateReportCardInput,
  ): Promise<ReportCardModel> {
    return this.cards.updateReportCard(id, input) as Promise<ReportCardModel>;
  }

  @Mutation(() => Boolean)
  @CheckAbility('manage', 'ReportCard')
  async deleteReportCard(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    await this.cards.deleteReportCard(id);
    return true;
  }

  @Mutation(() => Int, { description: 'Generate per-student instances for a section.' })
  @CheckAbility('manage', 'ReportCard')
  async generateReportCards(
    @Args('reportCardId', { type: () => ID }) reportCardId: string,
    @Args('sectionId', { type: () => ID }) sectionId: string,
  ): Promise<number> {
    const instances = await this.cards.generate(reportCardId, sectionId);
    return instances.length;
  }

  @Mutation(() => Int, { description: 'Publish all generated instances; returns the count.' })
  @CheckAbility('manage', 'ReportCard')
  publishReportCards(
    @Args('reportCardId', { type: () => ID }) reportCardId: string,
  ): Promise<number> {
    return this.cards.publish(reportCardId);
  }

  // The GraphQL type is ReportCardInstanceModel (decorator); the record's jsonb
  // `payload` already matches ReportCardPayloadModel field-for-field, so it is
  // returned as the record type (a record→model cast can't bridge the jsonb).
  @Query(() => [ReportCardInstanceModel], { description: 'Instances of a report card.' })
  @CheckAbility('read', 'ReportCard')
  reportCardInstances(
    @Args('reportCardId', { type: () => ID }) reportCardId: string,
  ): Promise<ReportCardInstanceRecord[]> {
    return this.cards.listInstances(reportCardId);
  }

  @Query(() => ReportCardInstanceModel)
  @CheckAbility('read', 'ReportCard')
  reportCardInstance(
    @Args('reportCardId', { type: () => ID }) reportCardId: string,
    @Args('studentProfileId', { type: () => ID }) studentProfileId: string,
  ): Promise<ReportCardInstanceRecord> {
    return this.cards.getInstance(reportCardId, studentProfileId);
  }

  @Query(() => [ReportCardInstanceModel], {
    description: 'Published report cards for the signed-in student.',
  })
  @CheckAbility('read', 'ReportCard')
  myReportCards(@CurrentUser() user: AuthUser): Promise<ReportCardInstanceRecord[]> {
    assertTenantContext(user);
    return this.cards.listForMembership(user.membershipId);
  }

  @Query(() => String, { description: 'Base64-encoded report-card PDF.' })
  @CheckAbility('read', 'ReportCard')
  async reportCardPdf(@Args('instanceId', { type: () => ID }) instanceId: string): Promise<string> {
    const buffer = await this.pdf.render(instanceId);
    return buffer.toString('base64');
  }
}
