/**
 * Platform-admin GraphQL surface for reseller management (ROV-234 + ROV-97).
 *
 * Combines CRUD + tier-change (ROV-234) with the pre-existing suspend /
 * unsuspend / delete lifecycle (ROV-97). All operations are platform-scoped
 * and CASL-gated via `manage:Reseller` (platform_admin) or `read:Reseller`
 * (platform_support, read-only).
 */
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser, PlatformScope } from '@roviq/auth-backend';
import { CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { ResellerTier } from '@roviq/common-types';
import { AdminResellerService } from './admin-reseller.service';
import { AdminCreateResellerInput } from './dto/admin-create-reseller.input';
import { AdminListResellersFilterInput } from './dto/admin-list-resellers-filter.input';
import { AdminUpdateResellerInput } from './dto/admin-update-reseller.input';
import { AdminResellerConnection, AdminResellerModel } from './models/admin-reseller.model';

@PlatformScope()
@Resolver(() => AdminResellerModel)
export class AdminResellerResolver {
  constructor(private readonly resellerService: AdminResellerService) {}

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
    description: 'Update mutable reseller fields (name, branding, customDomain)',
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

  @Mutation(() => Boolean, {
    description: 'Suspend a reseller and revoke all staff sessions',
  })
  @CheckAbility({ action: 'suspend', subject: 'Reseller' })
  async adminSuspendReseller(
    @Args('resellerId') resellerId: string,
    @CurrentUser() user: AuthUser,
    @Args('reason', { nullable: true }) reason?: string,
  ): Promise<boolean> {
    await this.resellerService.suspendReseller(resellerId, user.userId, reason);
    return true;
  }

  @Mutation(() => Boolean, {
    description: 'Unsuspend a previously suspended reseller (reactivates staff login)',
  })
  @CheckAbility({ action: 'update', subject: 'Reseller' })
  async adminUnsuspendReseller(
    @Args('resellerId') resellerId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<boolean> {
    await this.resellerService.unsuspendReseller(resellerId, user.userId);
    return true;
  }

  @Mutation(() => Boolean, {
    description: 'Delete a suspended reseller after 30-day grace period',
  })
  @CheckAbility({ action: 'delete', subject: 'Reseller' })
  async adminDeleteReseller(
    @Args('resellerId') resellerId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<boolean> {
    await this.resellerService.deleteReseller(resellerId, user.userId);
    return true;
  }
}
