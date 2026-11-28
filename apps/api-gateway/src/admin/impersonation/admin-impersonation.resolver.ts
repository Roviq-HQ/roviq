import { UseGuards } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { NoAudit } from '@roviq/audit';
import { CurrentUser, GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { StartImpersonationResult } from '../../auth/dto/impersonation.dto';
import { ImpersonationSessionModel } from '../../auth/dto/impersonation-session.model';
import { extractMeta, type GqlContext } from '../../auth/gql-context';
import { ImpersonationService } from '../../auth/impersonation.service';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver()
export class AdminImpersonationResolver {
  constructor(private readonly impersonationService: ImpersonationService) {}

  /** Platform admins: list impersonation sessions across all scopes (newest first). */
  @Query(() => [ImpersonationSessionModel])
  @CheckAbility({ action: 'read', subject: 'AuditLog' })
  async adminImpersonationSessions(
    @Args('activeOnly', { type: () => Boolean, nullable: true }) activeOnly?: boolean,
    @Args('sessionId', { nullable: true }) sessionId?: string,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 50 }) first?: number,
  ): Promise<ImpersonationSessionModel[]> {
    return this.impersonationService.listSessions({
      activeOnly: activeOnly ?? false,
      sessionId,
      limit: Math.min(first ?? 50, 100),
    });
  }

  @NoAudit()
  @Mutation(() => StartImpersonationResult)
  @CheckAbility({ action: 'impersonate', subject: 'User' })
  @RateLimit('impersonation')
  async adminStartImpersonation(
    @Args('targetUserId') targetUserId: string,
    @Args('targetTenantId') targetTenantId: string,
    @Args('reason') reason: string,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<StartImpersonationResult> {
    return this.impersonationService.startImpersonation(
      user,
      targetUserId,
      targetTenantId,
      reason,
      extractMeta(ctx),
    );
  }

  @NoAudit()
  @Mutation(() => StartImpersonationResult)
  @CheckAbility({ action: 'impersonate', subject: 'User' })
  @RateLimit('oneTimeCode')
  async adminVerifyImpersonationOtp(
    @Args('sessionId') sessionId: string,
    @Args('otp') otp: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StartImpersonationResult> {
    return this.impersonationService.verifyOtp(user, sessionId, otp);
  }

  @NoAudit()
  @Mutation(() => Boolean)
  async adminEndImpersonation(
    @Args('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<boolean> {
    await this.impersonationService.endImpersonation(sessionId, user, extractMeta(ctx));
    return true;
  }
}
