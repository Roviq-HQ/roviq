import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { NoAudit } from '@roviq/audit';
import { assertTenantContext, CurrentUser, GqlAuthGuard } from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { AuthService } from './auth.service';
import { AllowWhenPasswordChangeRequired } from './decorators/allow-when-password-change-required.decorator';
import { AuthPayload, InstituteLoginResult, SessionInfo, UserType } from './dto/auth-payload';
import { ChangePasswordArgs } from './dto/change-password.args';
import { UpdateLocaleInput } from './dto/update-locale.input';
import { extractMeta, type GqlContext } from './gql-context';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  // ── Three login mutations ──────────────────────────────

  @NoAudit()
  @Mutation(() => AuthPayload)
  async adminLogin(
    @Args('username') username: string,
    @Args('password') password: string,
    @Context() ctx: GqlContext,
  ): Promise<AuthPayload> {
    return this.authService.adminLogin(username, password, extractMeta(ctx));
  }

  @NoAudit()
  @Mutation(() => AuthPayload)
  async resellerLogin(
    @Args('username') username: string,
    @Args('password') password: string,
    @Context() ctx: GqlContext,
  ): Promise<AuthPayload> {
    return this.authService.resellerLogin(username, password, extractMeta(ctx));
  }

  @NoAudit()
  @Mutation(() => InstituteLoginResult)
  async instituteLogin(
    @Args('username') username: string,
    @Args('password') password: string,
    @Context() ctx: GqlContext,
  ): Promise<InstituteLoginResult> {
    return this.authService.instituteLogin(username, password, extractMeta(ctx));
  }

  // ── Institute selection (multi-institute flow) ─────────

  @NoAudit()
  @Mutation(() => AuthPayload)
  async selectInstitute(
    @Args('selectionToken') selectionToken: string,
    @Args('membershipId') membershipId: string,
    @Context() ctx: GqlContext,
  ): Promise<AuthPayload> {
    return this.authService.selectInstitute(selectionToken, membershipId, extractMeta(ctx));
  }

  // ── Institute switching ────────────────────────────────

  @NoAudit()
  @Mutation(() => AuthPayload)
  @UseGuards(GqlAuthGuard)
  async switchInstitute(
    @Args('membershipId') membershipId: string,
    @Args('currentRefreshToken') currentRefreshToken: string,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<AuthPayload> {
    assertTenantContext(user);
    return this.authService.switchInstitute(
      user,
      membershipId,
      currentRefreshToken,
      extractMeta(ctx),
    );
  }

  // ── Token refresh ──────────────────────────────────────

  @NoAudit()
  @Mutation(() => AuthPayload)
  async refreshToken(
    @Args('token') token: string,
    @Context() ctx: GqlContext,
  ): Promise<AuthPayload> {
    return this.authService.refreshToken(token, extractMeta(ctx));
  }

  // ── Logout ─────────────────────────────────────────────

  @NoAudit()
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  @AllowWhenPasswordChangeRequired()
  async logout(
    @Args('currentRefreshToken', {
      description: 'Refresh token of the session to end. Other sessions stay signed in.',
    })
    currentRefreshToken: string,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<boolean> {
    await this.authService.logout(user, currentRefreshToken, extractMeta(ctx));
    return true;
  }

  // ── Session management ─────────────────────────────────

  @Query(() => [SessionInfo])
  @UseGuards(GqlAuthGuard)
  async mySessions(
    @Args('currentRefreshToken', {
      description: 'Identifies the current session without returning token hashes.',
    })
    currentRefreshToken: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SessionInfo[]> {
    const sessions = await this.authService.getActiveSessions(user.userId, currentRefreshToken);
    return sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.deviceInfo ?? undefined,
      ipAddress: s.ipAddress ?? undefined,
      userAgent: s.userAgent ?? undefined,
      lastUsedAt: s.lastUsedAt ?? undefined,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isCurrent: s.isCurrent,
    }));
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async revokeSession(
    @Args('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<boolean> {
    await this.authService.revokeSession(user.userId, sessionId);
    return true;
  }

  @NoAudit()
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async revokeAllOtherSessions(
    @Args('currentRefreshToken') currentRefreshToken: string,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<boolean> {
    await this.authService.revokeAllOtherSessions(
      user.userId,
      currentRefreshToken,
      extractMeta(ctx),
    );
    return true;
  }

  // ── Password change (ROV-96) ───────────────────────────

  @NoAudit()
  @Mutation(() => Boolean, {
    description:
      'Rotate the authenticated user password. Revokes ALL sessions (caller must re-login). Allowed even when must_change_password is set so first-login enforcement can complete.',
  })
  @UseGuards(GqlAuthGuard)
  @AllowWhenPasswordChangeRequired()
  async changePassword(
    @Args() args: ChangePasswordArgs,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<boolean> {
    await this.authService.changePassword(
      user.userId,
      args.currentPassword,
      args.newPassword,
      extractMeta(ctx),
    );
    return true;
  }

  @Query(() => String, {
    nullable: true,
    description: 'Saved language for the authenticated account across all portals.',
  })
  @UseGuards(GqlAuthGuard)
  async myPreferredLocale(@CurrentUser() user: AuthUser): Promise<string | null> {
    return this.authService.getPreferredLocale(user.userId);
  }

  @Mutation(() => String, { nullable: true })
  @UseGuards(GqlAuthGuard)
  async updateMyPreferredLocale(
    @Args('input') input: UpdateLocaleInput,
    @CurrentUser() user: AuthUser,
  ): Promise<string | null> {
    if (user.isImpersonated)
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'Cannot change account preferences while impersonating',
      );
    return this.authService.updatePreferredLocale(user.userId, input.locale ?? null);
  }

  // ── Me query ───────────────────────────────────────────

  @Query(() => UserType)
  @UseGuards(GqlAuthGuard)
  @AllowWhenPasswordChangeRequired()
  async me(@CurrentUser() user: AuthUser): Promise<UserType> {
    assertTenantContext(user);
    const dbUser = await this.authService.getUserById(user.userId);
    const abilityRules = await this.authService.getAbilityRules(
      user.userId,
      user.scope,
      user.tenantId,
      user.membershipId,
      user.roleId,
    );
    const primaryNavSlugs = await this.authService.getPrimaryNavSlugs(user.roleId);

    return {
      id: user.userId,
      username: dbUser?.username ?? '',
      email: dbUser?.email ?? '',
      scope: user.scope,
      tenantId: user.tenantId,
      roleId: user.roleId,
      abilityRules,
      primaryNavSlugs,
    };
  }
}
