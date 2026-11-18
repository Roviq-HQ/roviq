import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { InstituteGroupService } from './institute-group.service';
import { GroupMembershipModel } from './models/group-membership.model';
import { InstituteGroupModel } from './models/institute-group.model';

// Group management is platform scope (AdminInstituteGroupResolver); an institute only reads its own.
@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => InstituteGroupModel)
export class InstituteGroupResolver {
  constructor(private readonly instituteGroupService: InstituteGroupService) {}

  @Query(() => InstituteGroupModel, {
    nullable: true,
    description: "The group the caller's own institute belongs to, or null when it has none.",
  })
  @CheckAbility({ action: 'read', subject: 'InstituteGroup' })
  async myInstituteGroup(@CurrentUser() user: AuthUser): Promise<InstituteGroupModel | null> {
    assertTenantContext(user);
    return this.instituteGroupService.findForTenant(user.tenantId);
  }

  @Query(() => [GroupMembershipModel])
  @CheckAbility({ action: 'read', subject: 'InstituteGroup' })
  async myGroups(@CurrentUser() user: AuthUser): Promise<GroupMembershipModel[]> {
    return this.instituteGroupService.findMyGroups(user.userId);
  }
}
