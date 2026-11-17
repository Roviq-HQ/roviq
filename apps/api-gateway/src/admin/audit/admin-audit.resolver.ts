import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { AuditService } from '../../audit/audit.service';
import { AuditLogFilterInput } from '../../audit/dto/audit-log-filter.input';
import { AuditLogConnection } from '../../audit/models/audit-log-connection.model';
import { AuthEventModel } from '../../audit/models/auth-event.model';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver()
export class AdminAuditResolver {
  constructor(private readonly auditService: AuditService) {}

  /** Platform admins: see ALL audit logs across every scope and tenant */
  @Query(() => AuditLogConnection)
  @CheckAbility({ action: 'read', subject: 'AuditLog' })
  async adminAuditLogs(
    @Args('filter', { nullable: true }) filter?: AuditLogFilterInput,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<AuditLogConnection> {
    const { tenantId, ...restFilter } = filter ?? {};
    return this.auditService.findAuditLogs({
      tenantId,
      filter: restFilter,
      first: Math.min(first ?? 20, 100),
      after,
    });
  }

  /** Login/logout/refresh events across all scopes */
  @Query(() => [AuthEventModel])
  @CheckAbility({ action: 'read', subject: 'AuditLog' })
  async adminAuthEvents(
    @Args('first', { type: () => Int, nullable: true, defaultValue: 50 }) first?: number,
  ): Promise<AuthEventModel[]> {
    return this.auditService.findAuthEvents(undefined, first ?? 50);
  }
}
