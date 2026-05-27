import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  auditLogs,
  authEvents,
  DRIZZLE_DB,
  type DrizzleDB,
  impersonationSessions,
  institutes,
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  resellersLive,
  users,
  withAdmin,
  withReseller,
  withTenant,
} from '@roviq/database';
import { and, count, desc, eq, gte, inArray, isNotNull, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditQueryRepository, type AuthEventRow } from './audit-query.repository';
import type { AuditLogQueryResult, AuditLogRow, FindAuditLogsParams } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string): { timestamp: string; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString();
  const separatorIndex = decoded.lastIndexOf(':');
  if (separatorIndex === -1) {
    throw new BadRequestException('Invalid cursor format');
  }
  const timestamp = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);
  if (Number.isNaN(Date.parse(timestamp)) || !UUID_RE.test(id)) {
    throw new BadRequestException('Invalid cursor format');
  }
  return { timestamp, id };
}

/**
 * Builds the WHERE clause for an audit-log query. Extracted from the resolver method to keep
 * its cognitive complexity in bounds. `needsSessionJoin` signals when impersonation_sessions
 * must be joined (only the impersonatorScope filter reads a column off that table).
 */
function buildAuditConditions(
  tenantId: string | undefined,
  filter: FindAuditLogsParams['filter'],
  after: string | undefined,
): { whereClause: SQL | undefined; needsSessionJoin: boolean } {
  const conditions: SQL[] = [];

  // Defense-in-depth: explicit tenant filter alongside RLS (skip for platform admins)
  if (tenantId) {
    conditions.push(eq(auditLogs.tenantId, tenantId));
  }

  // Cursor: base64url("timestamp:uuid") → WHERE (created_at, id) < ($N, $N)
  if (after) {
    const { timestamp, id } = decodeCursor(after);
    conditions.push(
      sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${timestamp}::timestamptz, ${id}::uuid)`,
    );
  }

  if (filter?.entityType) conditions.push(eq(auditLogs.entityType, filter.entityType));
  if (filter?.entityId) conditions.push(eq(auditLogs.entityId, filter.entityId));
  if (filter?.userId) conditions.push(eq(auditLogs.userId, filter.userId));
  if (filter?.actionTypes?.length) {
    conditions.push(inArray(auditLogs.actionType, filter.actionTypes));
  }
  if (filter?.correlationId) conditions.push(eq(auditLogs.correlationId, filter.correlationId));
  if (filter?.dateRange) {
    conditions.push(gte(auditLogs.createdAt, filter.dateRange.from));
    conditions.push(lte(auditLogs.createdAt, filter.dateRange.to));
  }
  if (filter?.syntheticOrigin) {
    conditions.push(eq(auditLogs.syntheticOrigin, filter.syntheticOrigin));
  }
  if (filter?.impersonatedOnly) conditions.push(isNotNull(auditLogs.impersonationSessionId));
  if (filter?.impersonationSessionId) {
    conditions.push(eq(auditLogs.impersonationSessionId, filter.impersonationSessionId));
  }

  // impersonatorScope lives on impersonation_sessions, so this filter needs the session join.
  const impersonatorScopes = filter?.impersonatorScope;
  if (impersonatorScopes?.length) {
    conditions.push(inArray(impersonationSessions.impersonatorScope, impersonatorScopes));
  }

  return { whereClause: and(...conditions), needsSessionJoin: !!impersonatorScopes?.length };
}

@Injectable()
export class AuditQueryDrizzleRepository extends AuditQueryRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findAuditLogs(params: FindAuditLogsParams): Promise<AuditLogQueryResult> {
    const { tenantId, resellerId, filter, first, after } = params;

    // Scope-aware DB wrapper: institute → withTenant, reseller → withReseller, platform → withAdmin
    const runInContext = (fn: (tx: DrizzleDB) => Promise<AuditLogQueryResult>) => {
      if (tenantId)
        return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:audit-query'), fn);
      if (resellerId)
        return withReseller(this.db, mkResellerCtx(resellerId, 'repository:audit-query'), fn);
      return withAdmin(this.db, mkAdminCtx('repository:audit-query'), fn);
    };

    return runInContext(async (tx) => {
      const { whereClause, needsSessionJoin } = buildAuditConditions(tenantId, filter, after);

      // Aliases for actor and user JOINs (both reference the users table)
      const actor = alias(users, 'actor');
      const userAlias = alias(users, 'u');

      // Fetch first+1 to determine hasNextPage, with actor/user/institute names via LEFT JOIN
      let dataQuery = tx
        .select({
          id: auditLogs.id,
          scope: auditLogs.scope,
          tenantId: auditLogs.tenantId,
          resellerId: auditLogs.resellerId,
          userId: auditLogs.userId,
          actorId: auditLogs.actorId,
          impersonatorId: auditLogs.impersonatorId,
          impersonationSessionId: auditLogs.impersonationSessionId,
          action: auditLogs.action,
          actionType: auditLogs.actionType,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          changes: auditLogs.changes,
          metadata: auditLogs.metadata,
          correlationId: auditLogs.correlationId,
          ipAddress: auditLogs.ipAddress,
          userAgent: auditLogs.userAgent,
          source: auditLogs.source,
          syntheticOrigin: auditLogs.syntheticOrigin,
          createdAt: auditLogs.createdAt,
          actorName: actor.username,
          userName: userAlias.username,
          tenantName: institutes.name,
          resellerName: resellersLive.name,
          resellerTier: resellersLive.tier,
        })
        .from(auditLogs)
        .leftJoin(actor, eq(actor.id, auditLogs.actorId))
        .leftJoin(userAlias, eq(userAlias.id, auditLogs.userId))
        .leftJoin(institutes, eq(institutes.id, auditLogs.tenantId))
        .leftJoin(resellersLive, eq(resellersLive.id, auditLogs.resellerId))
        .$dynamic();

      let countQuery = tx.select({ total: count() }).from(auditLogs).$dynamic();

      // impersonation_sessions is one-to-one on impersonation_session_id, so the LEFT JOIN
      // neither duplicates rows nor changes counts — added only when the scope filter needs it.
      if (needsSessionJoin) {
        const sessionJoin = eq(impersonationSessions.id, auditLogs.impersonationSessionId);
        dataQuery = dataQuery.leftJoin(impersonationSessions, sessionJoin);
        countQuery = countQuery.leftJoin(impersonationSessions, sessionJoin);
      }

      const [dataRows, countRows] = await Promise.all([
        dataQuery
          .where(whereClause)
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(first + 1),
        countQuery.where(whereClause),
      ]);

      const hasNextPage = dataRows.length > first;
      const rows = dataRows.slice(0, first);
      const totalCount = countRows[0]?.total ?? 0;

      const edges = rows.map((row) => ({
        cursor: Buffer.from(`${row.createdAt.toISOString()}:${row.id}`).toString('base64url'),
        node: this.mapRow(row),
      }));

      return {
        edges,
        totalCount,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!after,
          endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
          startCursor: edges.length > 0 ? edges[0].cursor : null,
        },
      };
    });
  }

  async findAuthEvents(tenantId: string | undefined, first: number): Promise<AuthEventRow[]> {
    const runInContext = tenantId
      ? (fn: (tx: DrizzleDB) => Promise<AuthEventRow[]>) =>
          withTenant(this.db, mkInstituteCtx(tenantId, 'repository:audit-query'), fn)
      : (fn: (tx: DrizzleDB) => Promise<AuthEventRow[]>) =>
          withAdmin(this.db, mkAdminCtx('repository:audit-query'), fn);

    return runInContext(async (tx) => {
      const conditions: SQL[] = [];
      if (tenantId) {
        conditions.push(eq(authEvents.tenantId, tenantId));
      }

      const rows = await tx
        .select()
        .from(authEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(authEvents.createdAt))
        .limit(first);

      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        eventType: row.eventType,
        scope: row.scope,
        tenantId: row.tenantId,
        resellerId: row.resellerId,
        authMethod: row.authMethod,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        failureReason: row.failureReason,
        metadata: row.metadata as Record<string, unknown> | null,
        createdAt: row.createdAt,
      }));
    });
  }

  private mapRow(row: {
    id: string;
    scope: string;
    tenantId: string | null;
    resellerId: string | null;
    userId: string;
    actorId: string;
    impersonatorId: string | null;
    impersonationSessionId: string | null;
    action: string;
    actionType: string;
    entityType: string;
    entityId: string | null;
    changes: unknown;
    metadata: unknown;
    correlationId: string;
    ipAddress: string | null;
    userAgent: string | null;
    source: string;
    syntheticOrigin: string | null;
    createdAt: Date;
    actorName: string | null;
    userName: string | null;
    tenantName: Record<string, string> | null;
    resellerName: string | null;
    resellerTier: string | null;
  }): AuditLogRow {
    return {
      id: row.id,
      scope: row.scope,
      tenantId: row.tenantId,
      resellerId: row.resellerId,
      userId: row.userId,
      actorId: row.actorId,
      impersonatorId: row.impersonatorId,
      impersonationSessionId: row.impersonationSessionId,
      action: row.action,
      actionType: row.actionType,
      entityType: row.entityType,
      entityId: row.entityId,
      changes: row.changes as Record<string, unknown> | null,
      metadata: row.metadata as Record<string, unknown> | null,
      correlationId: row.correlationId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      source: row.source,
      syntheticOrigin: row.syntheticOrigin,
      createdAt: row.createdAt,
      actorName: row.actorName ?? null,
      userName: row.userName ?? null,
      tenantName: row.tenantName ?? null,
      resellerName: row.resellerName ?? null,
      resellerTier: row.resellerTier ?? null,
    };
  }
}
