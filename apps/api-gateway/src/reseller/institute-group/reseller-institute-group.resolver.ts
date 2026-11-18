import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertResellerContext,
  CurrentUser,
  GqlAuthGuard,
  ResellerScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { CreateInstituteGroupInput } from '../../institute/institute-group/dto/create-institute-group.input';
import { InstituteGroupModel } from '../../institute/institute-group/models/institute-group.model';
import { InstituteGroupConnection } from '../../institute/institute-group/models/institute-group-connection.model';
import { ResellerInstituteGroupService } from './reseller-institute-group.service';

@UseGuards(GqlAuthGuard, ResellerScopeGuard, AbilityGuard)
@Resolver(() => InstituteGroupModel)
export class ResellerInstituteGroupResolver {
  constructor(private readonly groupService: ResellerInstituteGroupService) {}

  @Mutation(() => InstituteGroupModel, {
    description: "Creates a group owned by the caller's reseller.",
  })
  @CheckAbility({ action: 'create', subject: 'InstituteGroup' })
  async resellerCreateInstituteGroup(
    @CurrentUser() user: AuthUser,
    @Args('input') input: CreateInstituteGroupInput,
  ) {
    assertResellerContext(user);
    return this.groupService.create(user.resellerId, input);
  }

  @Query(() => InstituteGroupConnection, {
    description:
      'Groups the reseller owns or that contain its institutes; counts cover only its own institutes.',
  })
  @CheckAbility({ action: 'read', subject: 'InstituteGroup' })
  async resellerListInstituteGroups(@CurrentUser() user: AuthUser) {
    assertResellerContext(user);
    return this.groupService.list(user.resellerId);
  }

  @Mutation(() => Boolean, {
    description: "Links one of the reseller's institutes to a group the reseller owns.",
  })
  @CheckAbility({ action: 'manage', subject: 'InstituteGroup' })
  async resellerAddInstituteToGroup(
    @CurrentUser() user: AuthUser,
    @Args('instituteId', { type: () => ID }) instituteId: string,
    @Args('groupId', { type: () => ID }) groupId: string,
  ) {
    assertResellerContext(user);
    return this.groupService.addInstitute(user.resellerId, instituteId, groupId);
  }

  @Mutation(() => Boolean, {
    description: "Unlinks one of the reseller's institutes from a group the reseller owns.",
  })
  @CheckAbility({ action: 'manage', subject: 'InstituteGroup' })
  async resellerRemoveInstituteFromGroup(
    @CurrentUser() user: AuthUser,
    @Args('instituteId', { type: () => ID }) instituteId: string,
  ) {
    assertResellerContext(user);
    return this.groupService.removeInstitute(user.resellerId, instituteId);
  }
}
