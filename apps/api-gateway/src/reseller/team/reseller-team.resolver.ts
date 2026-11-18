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
import { ResellerInviteTeamMemberInput } from './dto/reseller-invite-team-member.input';
import { ResellerTeamFilterInput } from './dto/reseller-team-filter.input';
import {
  ResellerTeamMemberConnection,
  ResellerTeamMemberDetailModel,
  ResellerTeamMemberModel,
  ResellerTeamRoleModel,
} from './models/reseller-team-member.model';
import { ResellerTeamService, type TeamActor } from './reseller-team.service';

function actorOf(user: AuthUser): TeamActor {
  assertResellerContext(user);
  return { resellerId: user.resellerId, userId: user.userId };
}

@UseGuards(GqlAuthGuard, ResellerScopeGuard, AbilityGuard)
@Resolver(() => ResellerTeamMemberModel)
export class ResellerTeamResolver {
  constructor(private readonly service: ResellerTeamService) {}

  @Query(() => ResellerTeamMemberConnection, {
    description: "The reseller's own staff, active and deactivated, oldest membership first",
  })
  @CheckAbility({ action: 'read', subject: 'ResellerTeam' })
  async resellerListTeamMembers(
    @CurrentUser() user: AuthUser,
    @Args('filter', { nullable: true }) filter?: ResellerTeamFilterInput,
  ) {
    return this.service.list(actorOf(user), filter ?? {});
  }

  @Query(() => ResellerTeamMemberDetailModel, {
    description: 'One team member with their live sessions',
  })
  @CheckAbility({ action: 'read', subject: 'ResellerTeam' })
  async resellerGetTeamMember(
    @Args('membershipId', { type: () => ID }) membershipId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.get(actorOf(user), membershipId);
  }

  @Query(() => [ResellerTeamRoleModel], {
    description:
      "Roles the caller may give a team member: none senior to their own role or to the reseller's tier. Empty for a viewer.",
  })
  @CheckAbility({ action: 'read', subject: 'ResellerTeam' })
  async resellerAssignableTeamRoles(@CurrentUser() user: AuthUser) {
    return this.service.assignableRoles(actorOf(user));
  }

  @Mutation(() => ResellerTeamMemberModel, {
    description:
      'Add a person to the team by email. An existing account is linked; a new one is created and sent a temporary password.',
  })
  @CheckAbility({ action: 'create', subject: 'ResellerTeam' })
  async resellerInviteTeamMember(
    @Args('input') input: ResellerInviteTeamMemberInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.invite(actorOf(user), input);
  }

  @Mutation(() => ResellerTeamMemberModel, {
    description: "Give a team member another of this reseller's roles",
  })
  @CheckAbility({ action: 'update', subject: 'ResellerTeam' })
  async resellerChangeTeamMemberRole(
    @Args('membershipId', { type: () => ID }) membershipId: string,
    @Args('roleId', { type: () => ID }) roleId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.changeRole(actorOf(user), membershipId, roleId);
  }

  @Mutation(() => ResellerTeamMemberModel, {
    description:
      "Deactivate a team member's membership and end their sessions. The user account is preserved.",
  })
  @CheckAbility({ action: 'update', subject: 'ResellerTeam' })
  async resellerDeactivateTeamMember(
    @Args('membershipId', { type: () => ID }) membershipId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.deactivate(actorOf(user), membershipId);
  }

  @Mutation(() => ResellerTeamMemberModel, {
    description: "Reactivate a deactivated team member's membership",
  })
  @CheckAbility({ action: 'update', subject: 'ResellerTeam' })
  async resellerReactivateTeamMember(
    @Args('membershipId', { type: () => ID }) membershipId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reactivate(actorOf(user), membershipId);
  }
}
