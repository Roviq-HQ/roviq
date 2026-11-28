import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { NoAudit } from '@roviq/audit';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { ImpersonationAuthPayload } from './dto/impersonation.dto';
import { extractMeta, type GqlContext } from './gql-context';
import { ImpersonationService } from './impersonation.service';

/**
 * Unauthenticated exchange endpoint — the impersonator has already obtained a one-time code
 * (via admin/reseller/institute scope-prefixed mutations). The code itself is the credential.
 *
 * All scope-isolated impersonation mutations (start/verifyOtp/end) live in the per-scope
 * module groups — see `admin/impersonation/`, `reseller/impersonation/`, `institute/impersonation/`.
 */
@Resolver()
export class ImpersonationResolver {
  constructor(private readonly impersonationService: ImpersonationService) {}

  @NoAudit()
  @Mutation(() => ImpersonationAuthPayload)
  @RateLimit('impersonation')
  async exchangeImpersonationCode(
    @Args('code') code: string,
    @Context() ctx: GqlContext,
  ): Promise<ImpersonationAuthPayload> {
    return this.impersonationService.exchangeCode(code, extractMeta(ctx));
  }
}
