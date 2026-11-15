import { UseGuards } from '@nestjs/common';
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
import { CreateEnquiryInput } from './dto/create-enquiry.input';
import { EnquiryFilterInput } from './dto/enquiry-filter.input';
import { UpdateEnquiryInput } from './dto/update-enquiry.input';
import { ApplicationModel } from './models/application.model';
import { EnquiryConnection, EnquiryModel } from './models/enquiry.model';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => EnquiryModel)
export class EnquiryResolver {
  constructor(
    private readonly admissionService: AdmissionService,
    private readonly queries: AdmissionQueryService,
  ) {}

  @Query(() => EnquiryConnection, { description: 'List enquiries with filters and pagination' })
  @CheckAbility('read', 'Enquiry')
  async listEnquiries(
    @CurrentReadAccess() access: InstituteReadAccess,
    @Args('filter', { nullable: true }) filter?: EnquiryFilterInput,
  ): Promise<InstanceType<typeof EnquiryConnection>> {
    return this.queries.listEnquiries(filter ?? {}, access);
  }

  @Mutation(() => EnquiryModel, { description: 'Create a pre-admission enquiry' })
  @CheckAbility('create', 'Enquiry')
  async createEnquiry(@Args('input') input: CreateEnquiryInput): Promise<EnquiryModel> {
    return this.admissionService.createEnquiry(input);
  }

  @Mutation(() => EnquiryModel, { description: 'Update an enquiry' })
  @CheckAbility('update', 'Enquiry')
  async updateEnquiry(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateEnquiryInput,
  ): Promise<EnquiryModel> {
    return this.admissionService.updateEnquiry(id, input);
  }

  @Mutation(() => ApplicationModel, { description: 'Convert enquiry to a formal application' })
  @CheckAbility('create', 'Application')
  async convertEnquiryToApplication(
    @Args('enquiryId', { type: () => ID }) enquiryId: string,
    @Args('standardId', { type: () => ID }) standardId: string,
    @Args('academicYearId', { type: () => ID }) academicYearId: string,
  ): Promise<ApplicationModel> {
    return this.admissionService.convertEnquiryToApplication(enquiryId, standardId, academicYearId);
  }

  @Subscription(() => EnquiryModel, {
    description: 'Real-time new enquiry notifications',
    filter: async function (
      this: EnquiryResolver,
      payload: { enquiryCreated: { id: string; tenantId: string } },
      _args: unknown,
      context: AbilityRequestContext,
    ) {
      return (
        context.req.user.scope === 'institute' &&
        payload.enquiryCreated.tenantId === context.req.user.tenantId &&
        this.queries.filterEvent(payload.enquiryCreated.id, 'Enquiry', context)
      );
    },
  })
  @CheckAbility('read', 'Enquiry')
  enquiryCreated() {
    return pubSub.asyncIterableIterator('ENQUIRY.created');
  }
}
