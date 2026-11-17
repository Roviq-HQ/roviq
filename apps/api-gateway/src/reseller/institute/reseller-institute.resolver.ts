import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, ResellerScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { InstituteFilterInput } from '../../institute/management/dto/institute-filter.input';
import { InstituteModel } from '../../institute/management/models/institute.model';
import { InstituteConnection } from '../../institute/management/models/institute-connection.model';
import { InstituteStatisticsModel } from '../../institute/management/models/institute-statistics.model';
import { ResellerCreateInstituteRequestInput } from './dto/reseller-create-institute-request.input';
import { ResellerInstituteService } from './reseller-institute.service';

@UseGuards(GqlAuthGuard, ResellerScopeGuard, AbilityGuard)
@Resolver(() => InstituteModel)
export class ResellerInstituteResolver {
  constructor(private readonly resellerInstituteService: ResellerInstituteService) {}

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'create', subject: 'Institute' })
  async resellerCreateInstituteRequest(@Args('input') input: ResellerCreateInstituteRequestInput) {
    return this.resellerInstituteService.createRequest(input);
  }

  @Query(() => InstituteConnection)
  @CheckAbility({ action: 'read', subject: 'Institute' })
  async resellerListInstitutes(@Args('filter', { nullable: true }) filter?: InstituteFilterInput) {
    return this.resellerInstituteService.list(filter ?? {});
  }

  @Query(() => InstituteModel)
  @CheckAbility({ action: 'read', subject: 'Institute' })
  async resellerGetInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.resellerInstituteService.findById(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'suspend', subject: 'Institute' })
  async resellerSuspendInstitute(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    return this.resellerInstituteService.suspend(id, reason);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'activate', subject: 'Institute' })
  async resellerReactivateInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.resellerInstituteService.reactivate(id);
  }

  @Query(() => InstituteStatisticsModel)
  @CheckAbility({ action: 'view_statistics', subject: 'Institute' })
  async resellerInstituteStatistics() {
    return this.resellerInstituteService.getStatistics();
  }
}
