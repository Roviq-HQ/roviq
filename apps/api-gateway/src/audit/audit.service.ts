import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AUDIT_DB_POOL } from './audit-db.provider';
import type { AuditLogFilterInput } from './dto/audit-log-filter.input';
import type { AuditLogConnection } from './models/audit-log-connection.model';

interface FindAuditLogsParams {
  tenantId: string;
  filter?: AuditLogFilterInput;
  first: number;
  after?: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_DB_POOL) private readonly pool: pg.Pool) {}

  async findAuditLogs(params: FindAuditLogsParams): Promise<AuditLogConnection> {
    const { tenantId, filter, first, after } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // RLS handles tenant scoping, but we also filter explicitly
    // for defense-in-depth and to leverage the tenant_id index prefix
    conditions.push(`tenant_id = $${paramIndex++}`);
    values.push(tenantId);

    // Cursor: base64url("timestamp:uuid") → WHERE (created_at, id) < ($N, $N)
    if (after) {
      const decoded = Buffer.from(after, 'base64url').toString();
      const separatorIndex = decoded.lastIndexOf(':');
      const timestamp = decoded.slice(0, separatorIndex);
      const id = decoded.slice(separatorIndex + 1);
      conditions.push(`(created_at, id) < ($${paramIndex++}, $${paramIndex++})`);
      values.push(timestamp, id);
    }

    if (filter?.entityType) {
      conditions.push(`entity_type = $${paramIndex++}`);
      values.push(filter.entityType);
    }
    if (filter?.entityId) {
      conditions.push(`entity_id = $${paramIndex++}`);
      values.push(filter.entityId);
    }
    if (filter?.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(filter.userId);
    }
    if (filter?.actionTypes?.length) {
      conditions.push(`action_type = ANY($${paramIndex++})`);
      values.push(filter.actionTypes);
    }
    if (filter?.correlationId) {
      conditions.push(`correlation_id = $${paramIndex++}`);
      values.push(filter.correlationId);
    }
    if (filter?.dateRange) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(filter.dateRange.from);
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(filter.dateRange.to);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Fetch first+1 to determine hasNextPage
    const dataQuery = `
      SELECT * FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${paramIndex++}
    `;
    values.push(first + 1);

    // Count query uses same filters without LIMIT
    const countValues = values.slice(0, -1);
    const countQuery = `SELECT COUNT(*) FROM audit_logs ${whereClause}`;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(dataQuery, values),
      this.pool.query(countQuery, countValues),
    ]);

    const hasNextPage = dataResult.rows.length > first;
    const rows = dataResult.rows.slice(0, first);
    const totalCount = Number.parseInt(countResult.rows[0].count, 10);

    const edges = rows.map((row: Record<string, unknown>) => ({
      cursor: Buffer.from(`${(row.created_at as Date).toISOString()}:${row.id}`).toString(
        'base64url',
      ),
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
  }

  private mapRow(row: Record<string, unknown>) {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      userId: row.user_id as string,
      actorId: row.actor_id as string,
      impersonatorId: row.impersonator_id as string | null,
      action: row.action as string,
      actionType: row.action_type as string,
      entityType: row.entity_type as string,
      entityId: row.entity_id as string | null,
      changes: row.changes as Record<string, unknown> | null,
      metadata: row.metadata as Record<string, unknown> | null,
      correlationId: row.correlation_id as string,
      ipAddress: row.ip_address as string | null,
      userAgent: row.user_agent as string | null,
      source: row.source as string,
      createdAt: row.created_at as Date,
    };
  }
}
