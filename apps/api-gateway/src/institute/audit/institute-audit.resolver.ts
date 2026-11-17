import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { AuditService } from '../../audit/audit.service';
import { AuditLogFilterInput } from '../../audit/dto/audit-log-filter.input';
import { AuditLogConnection } from '../../audit/models/audit-log-connection.model';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class InstituteAuditResolver {
  constructor(private readonly auditService: AuditService) {}

  /** Institute admins: see audit logs scoped to their tenant only */
  @Query(() => AuditLogConnection)
  @CheckAbility({ action: 'read', subject: 'AuditLog' })
  async auditLogs(
    @CurrentUser() user: AuthUser,
    @Args('filter', { nullable: true }) filter?: AuditLogFilterInput,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<AuditLogConnection> {
    assertTenantContext(user);
    return this.auditService.findAuditLogs({
      tenantId: user.tenantId,
      filter,
      first: Math.min(first ?? 20, 100),
      after,
    });
  }

  /** Audit trail of one entity within the tenant */
  @Query(() => AuditLogConnection)
  @CheckAbility({ action: 'read', subject: 'AuditLog' })
  async entityAuditTimeline(
    @CurrentUser() user: AuthUser,
    @Args('entityType') entityType: string,
    @Args('entityId') entityId: string,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<AuditLogConnection> {
    assertTenantContext(user);
    return this.auditService.findAuditLogs({
      tenantId: user.tenantId,
      filter: { entityType, entityId },
      first: Math.min(first ?? 20, 100),
      after,
    });
  }
}
