import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
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

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class InstituteImpersonationResolver {
  constructor(private readonly impersonationService: ImpersonationService) {}

  @NoAudit()
  @Mutation(() => StartImpersonationResult)
  @CheckAbility({ action: 'impersonate', subject: 'User' })
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
