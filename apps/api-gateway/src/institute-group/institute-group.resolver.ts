import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CheckAbility, GqlAuthGuard } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateInstituteGroupInput } from './dto/create-institute-group.input';
import { InstituteGroupFilterInput } from './dto/institute-group-filter.input';
import { UpdateInstituteGroupInput } from './dto/update-institute-group.input';
import { InstituteGroupService } from './institute-group.service';
import { GroupMembershipModel } from './models/group-membership.model';
import { InstituteGroupModel } from './models/institute-group.model';
import { InstituteGroupConnection } from './models/institute-group-connection.model';

@Resolver(() => InstituteGroupModel)
export class InstituteGroupResolver {
  constructor(private readonly instituteGroupService: InstituteGroupService) {}

  @Query(() => InstituteGroupConnection)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('read', 'InstituteGroup')
  async instituteGroups(
    @Args('filter', { nullable: true }) filter?: InstituteGroupFilterInput,
  ): Promise<InstanceType<typeof InstituteGroupConnection>> {
    return this.instituteGroupService.search(filter ?? {});
  }

  @Query(() => InstituteGroupModel)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('read', 'InstituteGroup')
  async instituteGroup(@Args('id', { type: () => ID }) id: string): Promise<InstituteGroupModel> {
    return this.instituteGroupService.findById(id);
  }

  @Query(() => [GroupMembershipModel])
  @UseGuards(GqlAuthGuard)
  @CheckAbility('read', 'InstituteGroup')
  async myGroups(@CurrentUser() user: AuthUser): Promise<GroupMembershipModel[]> {
    return this.instituteGroupService.findMyGroups(user.userId);
  }

  @Mutation(() => InstituteGroupModel)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('create', 'InstituteGroup')
  async createInstituteGroup(
    @Args('input') input: CreateInstituteGroupInput,
  ): Promise<InstituteGroupModel> {
    return this.instituteGroupService.create(input);
  }

  @Mutation(() => InstituteGroupModel)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('update', 'InstituteGroup')
  async updateInstituteGroup(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateInstituteGroupInput,
  ): Promise<InstituteGroupModel> {
    return this.instituteGroupService.update(id, input);
  }

  @Mutation(() => InstituteGroupModel)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('update', 'InstituteGroup')
  async activateInstituteGroup(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<InstituteGroupModel> {
    return this.instituteGroupService.activate(id);
  }

  @Mutation(() => InstituteGroupModel)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('update', 'InstituteGroup')
  async deactivateInstituteGroup(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<InstituteGroupModel> {
    return this.instituteGroupService.deactivate(id);
  }

  @Mutation(() => InstituteGroupModel)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('update', 'InstituteGroup')
  async suspendInstituteGroup(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<InstituteGroupModel> {
    return this.instituteGroupService.suspend(id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('delete', 'InstituteGroup')
  async deleteInstituteGroup(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.instituteGroupService.delete(id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('manage', 'InstituteGroup')
  async addInstituteToGroup(
    @Args('instituteId', { type: () => ID }) instituteId: string,
    @Args('groupId', { type: () => ID }) groupId: string,
  ): Promise<boolean> {
    return this.instituteGroupService.addInstituteToGroup(instituteId, groupId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('manage', 'InstituteGroup')
  async removeInstituteFromGroup(
    @Args('instituteId', { type: () => ID }) instituteId: string,
  ): Promise<boolean> {
    return this.instituteGroupService.removeInstituteFromGroup(instituteId);
  }

  @Mutation(() => GroupMembershipModel)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('manage', 'InstituteGroup')
  async addGroupMember(
    @Args('groupId', { type: () => ID }) groupId: string,
    @Args('userId', { type: () => ID }) userId: string,
    @Args('roleId', { type: () => ID }) roleId: string,
  ): Promise<GroupMembershipModel> {
    return this.instituteGroupService.addMember(groupId, userId, roleId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  @CheckAbility('manage', 'InstituteGroup')
  async removeGroupMember(
    @Args('groupId', { type: () => ID }) groupId: string,
    @Args('userId', { type: () => ID }) userId: string,
  ): Promise<boolean> {
    return this.instituteGroupService.removeMember(groupId, userId);
  }
}
