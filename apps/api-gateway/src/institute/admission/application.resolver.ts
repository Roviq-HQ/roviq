import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import {
  AbilityGuard,
  type AbilityRequestContext,
  CheckAbility,
  CurrentReadAccess,
  type InstituteReadAccess,
} from '@roviq/casl';
import { pubSub } from '../../common/pubsub';
import { AdmissionService } from './admission.service';
import { AdmissionQueryService } from './admission-query.service';
import { AdmissionStatisticsFilterInput } from './dto/admission-statistics-filter.input';
import { CreateApplicationInput, UpdateApplicationInput } from './dto/create-application.input';
import { ApplicationFilterInput } from './dto/enquiry-filter.input';
import { AdmissionStatisticsModel } from './models/admission-statistics.model';
import {
  ApplicationConnection,
  ApplicationModel,
  ApplicationStatusUpdate,
} from './models/application.model';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => ApplicationModel)
export class ApplicationResolver {
  constructor(
    private readonly admissionService: AdmissionService,
    private readonly queries: AdmissionQueryService,
  ) {}

  @Query(() => ApplicationConnection, { description: 'List applications with filters' })
  @CheckAbility({ action: 'read', subject: 'Application', rows: 'scoped' })
  async listApplications(
    @CurrentReadAccess() access: InstituteReadAccess,
    @Args('filter', { nullable: true }) filter?: ApplicationFilterInput,
  ): Promise<InstanceType<typeof ApplicationConnection>> {
    return this.queries.listApplications(filter ?? {}, access);
  }

  @Query(() => ApplicationModel, { description: 'Get application by ID' })
  @CheckAbility({ action: 'read', subject: 'Application', rows: 'scoped' })
  async getApplication(
    @Args('id', { type: () => ID }) id: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<ApplicationModel> {
    return this.queries.getApplication(id, access);
  }

  @Query(() => AdmissionStatisticsModel, { description: 'Admission funnel statistics' })
  @CheckAbility({ action: 'read', subject: 'Application', rows: 'scoped' })
  async admissionStatistics(
    @CurrentReadAccess() access: InstituteReadAccess,
    @Args('filter', { nullable: true }) filter?: AdmissionStatisticsFilterInput,
  ): Promise<AdmissionStatisticsModel> {
    return this.queries.statistics(access, filter);
  }

  @Mutation(() => ApplicationModel, { description: 'Create a direct admission application' })
  @CheckAbility({ action: 'create', subject: 'Application' })
  async createApplication(@Args('input') input: CreateApplicationInput): Promise<ApplicationModel> {
    return this.admissionService.createApplication(input);
  }

  @Mutation(() => ApplicationModel, {
    description: 'Update application status (state machine validated)',
  })
  @CheckAbility({ action: 'update', subject: 'Application' })
  async updateApplication(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateApplicationInput,
  ): Promise<ApplicationModel> {
    return this.admissionService.updateApplication(id, input);
  }

  @Mutation(() => ApplicationModel, {
    description: 'Start the enrolment workflow; status stays FEE_PAID until done',
  })
  @CheckAbility({ action: 'update', subject: 'Application' })
  async approveApplication(
    @Args('id', { type: () => ID }) id: string,
    @Args(
      'sectionId',
      {
        type: () => ID,
        nullable: true,
        description: 'Section to place the student in; required unless the application has one',
      },
      new ParseUUIDPipe({ optional: true }),
    )
    sectionId?: string,
  ): Promise<ApplicationModel> {
    return this.admissionService.approveAndEnroll(id, sectionId);
  }

  @Mutation(() => ApplicationModel, { description: 'Reject an application' })
  @CheckAbility({ action: 'update', subject: 'Application' })
  async rejectApplication(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { nullable: true }) reason?: string,
  ): Promise<ApplicationModel> {
    return this.admissionService.rejectApplication(id, reason);
  }

  @Subscription(() => ApplicationStatusUpdate, {
    description: 'Real-time application status changes',
    filter: async function (
      this: ApplicationResolver,
      payload: { applicationStatusChanged: { applicationId: string; tenantId: string } },
      _args: unknown,
      context: AbilityRequestContext,
    ) {
      return (
        context.req.user.scope === 'institute' &&
        payload.applicationStatusChanged.tenantId === context.req.user.tenantId &&
        this.queries.filterEvent(
          payload.applicationStatusChanged.applicationId,
          'Application',
          context,
        )
      );
    },
  })
  @CheckAbility({ action: 'read', subject: 'Application', rows: 'scoped' })
  applicationStatusChanged() {
    return pubSub.asyncIterableIterator('APPLICATION.status_changed');
  }
}
