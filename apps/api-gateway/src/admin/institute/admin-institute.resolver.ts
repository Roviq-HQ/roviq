import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { InstituteService } from '../../institute/management/institute.service';
import { InstituteModel } from '../../institute/management/models/institute.model';
import { InstituteConnection } from '../../institute/management/models/institute-connection.model';
import { InstituteStatisticsModel } from '../../institute/management/models/institute-statistics.model';
import { AdminInstituteService } from './admin-institute.service';
import { AdminCreateInstituteInput } from './dto/admin-create-institute.input';
import { AdminListInstitutesFilterInput } from './dto/admin-list-institutes-filter.input';
import { AcademicTreeModel } from './models/academic-tree.model';
import { DeletedInstituteModel } from './models/deleted-institute.model';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver(() => InstituteModel)
export class AdminInstituteResolver {
  constructor(
    private readonly instituteService: InstituteService,
    private readonly adminService: AdminInstituteService,
  ) {}

  @Query(() => InstituteConnection)
  @CheckAbility({ action: 'read', subject: 'Institute' })
  async adminListInstitutes(
    @Args('filter', { nullable: true }) filter?: AdminListInstitutesFilterInput,
  ) {
    return this.adminService.list(filter ?? {});
  }

  @Query(() => InstituteModel)
  @CheckAbility({ action: 'read', subject: 'Institute' })
  async adminGetInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.findById(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'create', subject: 'Institute' })
  async adminCreateInstitute(@Args('input') input: AdminCreateInstituteInput) {
    return this.instituteService.create(input);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'approve', subject: 'Institute' })
  async adminApproveInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.adminService.approve(id);
  }

  @Mutation(() => InstituteModel, {
    description:
      'Activate institute (PENDING/INACTIVE/SUSPENDED → ACTIVE). Requires setup_status COMPLETED.',
  })
  @CheckAbility({ action: 'activate', subject: 'Institute' })
  async adminActivateInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.activate(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'reject', subject: 'Institute' })
  async adminRejectInstitute(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
  ) {
    return this.adminService.reject(id, reason);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'deactivate', subject: 'Institute' })
  async adminDeactivateInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.deactivate(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'suspend', subject: 'Institute' })
  async adminSuspendInstitute(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    return this.instituteService.suspend(id, reason);
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'delete', subject: 'Institute' })
  async adminDeleteInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.delete(id);
  }

  @Query(() => [DeletedInstituteModel], {
    description: 'Deleted institutes, most recently deleted first (at most 200).',
  })
  @CheckAbility({ action: 'restore', subject: 'Institute' })
  async adminListDeletedInstitutes(): Promise<DeletedInstituteModel[]> {
    return this.instituteService.listDeleted();
  }

  @Mutation(() => InstituteModel, {
    description: 'Bring a deleted institute back with the status it had when it was deleted.',
  })
  @CheckAbility({ action: 'restore', subject: 'Institute' })
  async adminRestoreInstitute(@Args('id', { type: () => ID }, ParseUUIDPipe) id: string) {
    return this.instituteService.restore(id);
  }

  @Mutation(() => InstituteModel, {
    description: 'Reassign an institute to a different active reseller',
  })
  @CheckAbility({ action: 'update', subject: 'Institute' })
  async adminReassignInstituteReseller(
    @Args('id', { type: () => ID }) id: string,
    @Args('newResellerId', { type: () => ID }) newResellerId: string,
  ) {
    return this.adminService.reassignReseller(id, newResellerId);
  }

  @Mutation(() => InstituteModel, {
    description: 'Assign an institute to a group (franchise/trust)',
  })
  @CheckAbility({ action: 'update', subject: 'Institute' })
  async adminAssignInstituteGroup(
    @Args('id', { type: () => ID }) id: string,
    @Args('groupId', { type: () => ID }) groupId: string,
  ) {
    return this.adminService.assignGroup(id, groupId);
  }

  @Mutation(() => InstituteModel, {
    description: 'Remove an institute from its group (clears the group assignment)',
  })
  @CheckAbility({ action: 'update', subject: 'Institute' })
  async adminRemoveInstituteGroup(@Args('id', { type: () => ID }) id: string) {
    return this.adminService.removeGroup(id);
  }

  @Mutation(() => InstituteModel, {
    description:
      'Retry the institute setup workflow for an institute whose setup failed or is stuck. Idempotent.',
  })
  @CheckAbility({ action: 'update', subject: 'Institute' })
  async adminRetryInstituteSetup(@Args('id', { type: () => ID }) id: string) {
    return this.adminService.retrySetup(id);
  }

  @Query(() => InstituteStatisticsModel)
  @CheckAbility({ action: 'view_statistics', subject: 'Institute' })
  async adminInstituteStatistics() {
    return this.adminService.getStatistics();
  }

  @Query(() => AcademicTreeModel, {
    description:
      'Read-only academic structure (standards → sections + subjects) for an institute — admin-view only, institute portal owns CRUD',
  })
  @CheckAbility({ action: 'read', subject: 'Institute' })
  async adminGetInstituteAcademicTree(
    @Args('instituteId', { type: () => ID }) instituteId: string,
  ) {
    return this.adminService.getAcademicTree(instituteId);
  }
}
