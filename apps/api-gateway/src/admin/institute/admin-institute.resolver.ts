import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { PlatformScope } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import GraphQLJSON from 'graphql-type-json';
import { InstituteService } from '../../institute/management/institute.service';
import {
  InstituteModel,
  InstituteStatusEnum,
} from '../../institute/management/models/institute.model';
import { InstituteConnection } from '../../institute/management/models/institute-connection.model';
import { AdminInstituteService } from './admin-institute.service';
import { InstituteFilterInput } from '../../institute/management/dto/institute-filter.input';
import { AdminCreateInstituteInput } from './dto/admin-create-institute.input';

@PlatformScope()
@UseGuards(AbilityGuard)
@Resolver(() => InstituteModel)
export class AdminInstituteResolver {
  constructor(
    private readonly instituteService: InstituteService,
    private readonly adminService: AdminInstituteService,
  ) {}

  @Query(() => InstituteConnection)
  @CheckAbility('read', 'Institute')
  async adminListInstitutes(
    @Args('filter', { nullable: true }) filter?: InstituteFilterInput,
  ) {
    return this.instituteService.search(filter ?? {});
  }

  @Query(() => InstituteModel)
  @CheckAbility('read', 'Institute')
  async adminGetInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.findById(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility('create', 'Institute')
  async adminCreateInstitute(@Args('input') input: AdminCreateInstituteInput) {
    return this.instituteService.create(input);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility('update_status', 'Institute')
  async adminApproveInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.adminService.approve(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility('update_status', 'Institute')
  async adminRejectInstitute(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
  ) {
    return this.adminService.reject(id, reason);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility('update_status', 'Institute')
  async adminUpdateInstituteStatus(
    @Args('id', { type: () => ID }) id: string,
    @Args('status', { type: () => InstituteStatusEnum }) status: InstituteStatusEnum,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    // Delegate to existing service methods based on target status
    switch (status) {
      case InstituteStatusEnum.ACTIVE:
        return this.instituteService.activate(id);
      case InstituteStatusEnum.INACTIVE:
        return this.instituteService.deactivate(id);
      case InstituteStatusEnum.SUSPENDED:
        return this.instituteService.suspend(id);
      default:
        throw new BadRequestException(`Unsupported target status: ${status}`);
    }
  }

  @Mutation(() => Boolean)
  @CheckAbility('delete', 'Institute')
  async adminDeleteInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.delete(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility('manage', 'Institute')
  async adminRestoreInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.restore(id);
  }

  @Query(() => GraphQLJSON)
  @CheckAbility('read', 'Institute')
  async adminInstituteStatistics() {
    return this.adminService.getStatistics();
  }
}
