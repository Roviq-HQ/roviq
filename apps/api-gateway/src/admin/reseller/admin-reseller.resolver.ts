/**
 * Platform-admin GraphQL surface for reseller management (ROV-234 + ROV-97).
 *
 * Combines CRUD + tier-change (ROV-234) with the pre-existing suspend /
 * unsuspend / delete lifecycle (ROV-97). All operations are platform-scoped
 * and CASL-gated via `manage:Reseller` (platform_admin) or `read:Reseller`
 * (platform_support, read-only).
 */
import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { CurrentUser, GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { ResellerTier } from '@roviq/common-types';
import { FileLoaders } from '../../files/file.loaders';
import { FileRefModel } from '../../files/models/file-ref.model';
import type { FileRecord } from '../../files/repositories/types';
import { AdminResellerService } from './admin-reseller.service';
import { AdminCreateResellerInput } from './dto/admin-create-reseller.input';
import { AdminListResellersFilterInput } from './dto/admin-list-resellers-filter.input';
import { AdminUpdateResellerInput } from './dto/admin-update-reseller.input';
import {
  AdminResellerConnection,
  AdminResellerModel,
  AdminResellerTeamMemberModel,
} from './models/admin-reseller.model';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver(() => AdminResellerModel)
export class AdminResellerResolver {
  constructor(
    private readonly resellerService: AdminResellerService,
    private readonly loaders: FileLoaders,
  ) {}

  @ResolveField(() => FileRefModel, {
    nullable: true,
    description: 'Logo uploaded by the reseller',
  })
  logo(@Parent() reseller: { logoFileId?: string | null }): Promise<FileRecord | null> {
    return reseller.logoFileId
      ? this.loaders.readyById.load(reseller.logoFileId)
      : Promise.resolve(null);
  }

  @ResolveField(() => FileRefModel, {
    nullable: true,
    description: 'Browser-tab icon uploaded by the reseller',
  })
  favicon(@Parent() reseller: { faviconFileId?: string | null }): Promise<FileRecord | null> {
    return reseller.faviconFileId
      ? this.loaders.readyById.load(reseller.faviconFileId)
      : Promise.resolve(null);
  }

  // ── Read ────────────────────────────────────────────────────

  @Query(() => AdminResellerConnection, {
    description: 'Platform admin: list resellers with cursor pagination, search, and filters',
  })
  @CheckAbility({ action: 'read', subject: 'Reseller' })
  async adminListResellers(
    @Args('filter', { nullable: true }) filter?: AdminListResellersFilterInput,
  ) {
    return this.resellerService.list(filter ?? {});
  }

  @Query(() => AdminResellerModel, {
    description: 'Fetch a single reseller by id with computed counts',
  })
  @CheckAbility({ action: 'read', subject: 'Reseller' })
  async adminGetReseller(@Args('id', { type: () => ID }) id: string) {
    return this.resellerService.getById(id);
  }

  @Query(() => [AdminResellerTeamMemberModel], {
    description: 'Staff (reseller_memberships) of one reseller, read-only for platform admins',
  })
  @CheckAbility({ action: 'read', subject: 'Reseller' })
  async adminListResellerTeam(@Args('resellerId', { type: () => ID }) resellerId: string) {
    return this.resellerService.listTeam(resellerId);
  }

  // ── Write ───────────────────────────────────────────────────

  @Mutation(() => AdminResellerModel, {
    description: 'Create a new reseller + initial admin user attached to the tier role',
  })
  @CheckAbility({ action: 'create', subject: 'Reseller' })
  async adminCreateReseller(
    @Args('input') input: AdminCreateResellerInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.resellerService.create(input, user.userId);
  }

  @Mutation(() => AdminResellerModel, {
    description:
      'Update reseller profile fields (name, branding, domain, registration, contact, address)',
  })
  @CheckAbility({ action: 'update', subject: 'Reseller' })
  async adminUpdateReseller(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: AdminUpdateResellerInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.resellerService.update(id, input, user.userId);
  }

  @Mutation(() => AdminResellerModel, {
    description:
      'Change reseller tier. Cascades to all reseller_memberships: their role_id is updated so staff abilities change on next token refresh.',
  })
  @CheckAbility({ action: 'update', subject: 'Reseller' })
  async adminChangeResellerTier(
    @Args('id', { type: () => ID }) id: string,
    @Args('newTier', { type: () => ResellerTier }) newTier: ResellerTier,
    @CurrentUser() user: AuthUser,
  ) {
    return this.resellerService.changeTier(id, newTier, user.userId);
  }

  // ── Lifecycle (ROV-97, preserved) ───────────────────────────

  @Mutation(() => AdminResellerModel, {
    description: 'Suspend a reseller and revoke all staff sessions',
  })
  @CheckAbility({ action: 'suspend', subject: 'Reseller' })
  async adminSuspendReseller(
    @Args('resellerId') resellerId: string,
    @CurrentUser() user: AuthUser,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    return this.resellerService.suspendReseller(resellerId, user.userId, reason);
  }

  @Mutation(() => AdminResellerModel, {
    description: 'Unsuspend a previously suspended reseller (reactivates staff login)',
  })
  @CheckAbility({ action: 'update', subject: 'Reseller' })
  async adminUnsuspendReseller(
    @Args('resellerId') resellerId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.resellerService.unsuspendReseller(resellerId, user.userId);
  }

  @Mutation(() => AdminResellerModel, {
    description: 'Delete a suspended reseller after 30-day grace period',
  })
  @CheckAbility({ action: 'delete', subject: 'Reseller' })
  async adminDeleteReseller(@Args('resellerId') resellerId: string, @CurrentUser() user: AuthUser) {
    return this.resellerService.deleteReseller(resellerId, user.userId);
  }
}
