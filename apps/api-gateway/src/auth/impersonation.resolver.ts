import { BadRequestException, ForbiddenException, UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { NoAudit } from '@roviq/audit';
import { CurrentUser, GqlAuthGuard } from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import { ImpersonationAuthPayload, StartImpersonationResult } from './dto/impersonation.dto';
import { ImpersonationService } from './impersonation.service';

interface GqlContext {
  req: {
    ip: string;
    headers: Record<string, string | string[] | undefined>;
  };
}

function extractMeta(ctx: GqlContext) {
  return {
    ip: ctx.req.ip,
    userAgent: ctx.req.headers['user-agent'] as string | undefined,
  };
}

@Resolver()
export class ImpersonationResolver {
  constructor(private readonly impersonationService: ImpersonationService) {}

  @NoAudit()
  @Mutation(() => StartImpersonationResult)
  @UseGuards(GqlAuthGuard)
  async startImpersonation(
    @Args('targetUserId') targetUserId: string,
    @Args('targetTenantId') targetTenantId: string,
    @Args('reason') reason: string,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<StartImpersonationResult> {
    return this.impersonationService.startImpersonation(
      user.userId,
      user.scope,
      targetUserId,
      targetTenantId,
      reason,
      extractMeta(ctx),
    );
  }

  @NoAudit()
  @Mutation(() => ImpersonationAuthPayload)
  async exchangeImpersonationCode(@Args('code') code: string): Promise<ImpersonationAuthPayload> {
    return this.impersonationService.exchangeCode(code);
  }

  @NoAudit()
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async endImpersonation(
    @Args('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<boolean> {
    await this.impersonationService.endImpersonation(sessionId, user.userId);
    return true;
  }

  @NoAudit()
  @Mutation(() => StartImpersonationResult)
  @UseGuards(GqlAuthGuard)
  async impersonateUser(
    @Args('targetUserId') targetUserId: string,
    @Args('reason') reason: string,
    @CurrentUser() user: AuthUser,
    @Context() ctx: GqlContext,
  ): Promise<StartImpersonationResult> {
    if (!user.tenantId) {
      throw new ForbiddenException('Institute scope required for intra-institute impersonation');
    }
    return this.impersonationService.startImpersonation(
      user.userId,
      user.scope,
      targetUserId,
      user.tenantId,
      reason,
      extractMeta(ctx),
    );
  }

  @NoAudit()
  @Mutation(() => StartImpersonationResult)
  @UseGuards(GqlAuthGuard)
  async verifyImpersonationOtp(
    @Args('sessionId') _sessionId: string,
    @Args('otp') _otp: string,
  ): Promise<StartImpersonationResult> {
    throw new BadRequestException('OTP verification not yet implemented');
  }
}
