import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import {
  assertResellerContext,
  CurrentUser,
  GqlAuthGuard,
  ResellerScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { AuditService } from '../../audit/audit.service';
import { AuditLogFilterInput } from '../../audit/dto/audit-log-filter.input';
import { AuditLogConnection } from '../../audit/models/audit-log-connection.model';

@UseGuards(GqlAuthGuard, ResellerScopeGuard, AbilityGuard)
@Resolver()
export class ResellerAuditResolver {
  constructor(private readonly auditService: AuditService) {}

  /** Resellers: see audit logs for their managed institutes + own reseller-scoped entries */
  @Query(() => AuditLogConnection)
  @CheckAbility({ action: 'read', subject: 'AuditLog' })
  async resellerAuditLogs(
    @CurrentUser() user: AuthUser,
    @Args('filter', { nullable: true }) filter?: AuditLogFilterInput,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<AuditLogConnection> {
    assertResellerContext(user);
    return this.auditService.findAuditLogs({
      resellerId: user.resellerId,
      filter,
      first: Math.min(first ?? 20, 100),
      after,
    });
  }
}
