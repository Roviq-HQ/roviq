import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { NoAudit } from '@roviq/audit';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { StartImpersonationResult } from '../../auth/dto/impersonation.dto';
import { extractMeta, type GqlContext } from '../../auth/gql-context';
import { ImpersonationService } from '../../auth/impersonation.service';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class InstituteImpersonationResolver {
  constructor(private readonly impersonationService: ImpersonationService) {}

  @Query(() => Boolean, {
    description:
      'Whether the caller may view as this user: an active member of the same institute whose every role ranks below the caller. Same rule as impersonateUser.',
  })
  @CheckAbility({ action: 'impersonate', subject: 'User' })
  async canImpersonateUser(
    @Args('targetUserId') targetUserId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<boolean> {
    assertTenantContext(user);
    return this.impersonationService.canImpersonateInInstitute(user, targetUserId);
  }

  @NoAudit()
  @Mutation(() => StartImpersonationResult)
  @CheckAbility({ action: 'impersonate', subject: 'User' })
  @RateLimit('impersonation')
  async impersonateUser(
    @Args('targetUserId') targetUserId: string,
    @Args('reason') reason: string,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<StartImpersonationResult> {
    assertTenantContext(user);
    return this.impersonationService.startImpersonation(
      user,
      targetUserId,
      user.tenantId,
      reason,
      extractMeta(ctx),
    );
  }

  @NoAudit()
  @Mutation(() => Boolean)
  async endImpersonation(
    @Args('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<boolean> {
    await this.impersonationService.endImpersonation(sessionId, user, extractMeta(ctx));
    return true;
  }
}
