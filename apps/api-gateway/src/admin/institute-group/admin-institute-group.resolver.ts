import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { CreateInstituteGroupInput } from '../../institute/institute-group/dto/create-institute-group.input';
import { InstituteGroupFilterInput } from '../../institute/institute-group/dto/institute-group-filter.input';
import { UpdateInstituteGroupInput } from '../../institute/institute-group/dto/update-institute-group.input';
import { InstituteGroupService } from '../../institute/institute-group/institute-group.service';
import { GroupMembershipModel } from '../../institute/institute-group/models/group-membership.model';
import { InstituteGroupModel } from '../../institute/institute-group/models/institute-group.model';
import { InstituteGroupConnection } from '../../institute/institute-group/models/institute-group-connection.model';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver(() => InstituteGroupModel)
export class AdminInstituteGroupResolver {
  constructor(private readonly groupService: InstituteGroupService) {}

  @Query(() => InstituteGroupConnection)
  @CheckAbility({ action: 'read', subject: 'InstituteGroup' })
  async adminListInstituteGroups(
    @Args('filter', { nullable: true }) filter?: InstituteGroupFilterInput,
  ) {
    return this.groupService.searchWithInstituteCounts(filter ?? {});
  }

  @Mutation(() => InstituteGroupModel)
  @CheckAbility({ action: 'create', subject: 'InstituteGroup' })
  async adminCreateInstituteGroup(@Args('input') input: CreateInstituteGroupInput) {
    return this.groupService.create(input, null);
  }

  @Mutation(() => InstituteGroupModel)
  @CheckAbility({ action: 'update', subject: 'InstituteGroup' })
  async adminUpdateInstituteGroup(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateInstituteGroupInput,
  ) {
    return this.groupService.update(id, input);
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'delete', subject: 'InstituteGroup' })
  async adminDeleteInstituteGroup(@Args('id', { type: () => ID }) id: string) {
    return this.groupService.delete(id);
  }

  @Mutation(() => InstituteGroupModel)
  @CheckAbility({ action: 'update', subject: 'InstituteGroup' })
  async adminActivateInstituteGroup(@Args('id', { type: () => ID }) id: string) {
    return this.groupService.activate(id);
  }

  @Mutation(() => InstituteGroupModel)
  @CheckAbility({ action: 'update', subject: 'InstituteGroup' })
  async adminDeactivateInstituteGroup(@Args('id', { type: () => ID }) id: string) {
    return this.groupService.deactivate(id);
  }

  @Mutation(() => InstituteGroupModel)
  @CheckAbility({ action: 'update', subject: 'InstituteGroup' })
  async adminSuspendInstituteGroup(@Args('id', { type: () => ID }) id: string) {
    return this.groupService.suspend(id);
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'manage', subject: 'InstituteGroup' })
  async adminAddInstituteToGroup(
    @Args('instituteId', { type: () => ID }) instituteId: string,
    @Args('groupId', { type: () => ID }) groupId: string,
  ) {
    return this.groupService.addInstituteToGroup(instituteId, groupId);
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'manage', subject: 'InstituteGroup' })
  async adminRemoveInstituteFromGroup(
    @Args('instituteId', { type: () => ID }) instituteId: string,
  ) {
    return this.groupService.removeInstituteFromGroup(instituteId);
  }

  @Mutation(() => GroupMembershipModel)
  @CheckAbility({ action: 'manage', subject: 'InstituteGroup' })
  async adminAddInstituteGroupMember(
    @Args('groupId', { type: () => ID }) groupId: string,
    @Args('userId', { type: () => ID }) userId: string,
    @Args('roleId', { type: () => ID }) roleId: string,
  ) {
    return this.groupService.addMember(groupId, userId, roleId);
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'manage', subject: 'InstituteGroup' })
  async adminRemoveInstituteGroupMember(
    @Args('groupId', { type: () => ID }) groupId: string,
    @Args('userId', { type: () => ID }) userId: string,
  ) {
    return this.groupService.removeMember(groupId, userId);
  }
}
