import { jetstream } from '@nats-io/jetstream';
import { type NatsConnection, headers as natsHeaders } from '@nats-io/nats-core';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DLQ_STATE_MACHINE, type DlqStatus } from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, dlqMessages, mkAdminCtx, withAdmin } from '@roviq/database';
import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '../common/pagination/relay-pagination.model';
import { DLQ_NATS_CONNECTION } from './dlq-nats.provider';
import type { DlqMessageFilterInput } from './models/dlq-message.model';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class DlqService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    @Inject(DLQ_NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  /**
   * Build the JetStreamServer replay envelope: the original subject, the
   * `{pattern,data}` body the server expects, and the restored correlation/
   * tenant headers. Pure so the replay contract can be asserted without NATS.
   */
  static buildReplayPublish(row: {
    originalSubject: string;
    payload: unknown;
    correlationId: string;
    tenantId: string | null;
  }): { subject: string; data: string; headers: Record<string, string> } {
    return {
      subject: row.originalSubject,
      data: JSON.stringify({ pattern: row.originalSubject, data: row.payload }),
      headers: {
        'correlation-id': row.correlationId,
        'tenant-id': row.tenantId ?? '',
      },
    };
  }

  /** List dead-lettered messages, newest-first, keyset-paginated on id DESC. */
  async list(filter: DlqMessageFilterInput = {}) {
    const limit = Math.min(filter.first ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const { records, totalCount } = await withAdmin(
      this.db,
      mkAdminCtx('service:dlq'),
      async (tx) => {
        const conditions: SQL[] = [];
        if (filter.originStream) conditions.push(eq(dlqMessages.originStream, filter.originStream));
        if (filter.status) conditions.push(eq(dlqMessages.status, filter.status));
        if (filter.tenantId) conditions.push(eq(dlqMessages.tenantId, filter.tenantId));
        if (filter.after) {
          const cursor = decodeCursor(filter.after);
          if (typeof cursor.id === 'string') conditions.push(sql`${dlqMessages.id} < ${cursor.id}`);
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [totalResult, rows] = await Promise.all([
          tx.select({ value: sql<number>`count(*)::int` }).from(dlqMessages).where(where),
          tx
            .select()
            .from(dlqMessages)
            .where(where)
            .orderBy(desc(dlqMessages.id))
            .limit(limit + 1),
        ]);
        return { records: rows, totalCount: totalResult[0]?.value ?? 0 };
      },
    );

    const hasNextPage = records.length > limit;
    const nodes = hasNextPage ? records.slice(0, limit) : records;
    const edges = nodes.map((node) => ({ node, cursor: encodeCursor({ id: node.id }) }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        // Forward-only keyset pagination: a previous page exists iff we paged past the first.
        hasPreviousPage: Boolean(filter.after),
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges[edges.length - 1]?.cursor ?? null,
      },
      totalCount,
    };
  }

  /** Re-publish a message to its original subject (pending|replayed → replayed). */
  async replay(id: string, replayedBy: string) {
    return withAdmin(this.db, mkAdminCtx('service:dlq'), async (tx) => {
      const [row] = await tx.select().from(dlqMessages).where(eq(dlqMessages.id, id));
      if (!row) throw new NotFoundException(`DLQ message ${id} not found`);

      const status: DlqStatus = row.status as DlqStatus;
      DLQ_STATE_MACHINE.assertTransition(status, 'replayed');

      const pub = DlqService.buildReplayPublish(row);
      const hdrs = natsHeaders();
      for (const [key, value] of Object.entries(pub.headers)) {
        if (value) hdrs.set(key, value);
      }
      await jetstream(this.nc).publish(pub.subject, pub.data, { headers: hdrs });

      const [updated] = await tx
        .update(dlqMessages)
        .set({
          status: 'replayed',
          replayedAt: new Date(),
          replayedBy,
          replayCount: row.replayCount + 1,
        })
        .where(eq(dlqMessages.id, id))
        .returning();
      return updated;
    });
  }

  /** Discard a message without replaying it (pending|replayed → discarded). */
  async discard(id: string) {
    return withAdmin(this.db, mkAdminCtx('service:dlq'), async (tx) => {
      const [row] = await tx.select().from(dlqMessages).where(eq(dlqMessages.id, id));
      if (!row) throw new NotFoundException(`DLQ message ${id} not found`);

      const status: DlqStatus = row.status as DlqStatus;
      DLQ_STATE_MACHINE.assertTransition(status, 'discarded');

      const [updated] = await tx
        .update(dlqMessages)
        .set({ status: 'discarded' })
        .where(eq(dlqMessages.id, id))
        .returning();
      return updated;
    });
  }
}
