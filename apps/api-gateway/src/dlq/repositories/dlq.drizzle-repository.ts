import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB, type DrizzleDB, dlqMessages, mkAdminCtx, withAdmin } from '@roviq/database';
import { and, count, desc, eq, gte, type SQL, sql } from 'drizzle-orm';
import { DlqRepository, type DlqStreamCount } from './dlq.repository';
import type { DlqListQuery, DlqMessageRecord, DlqTransitionResult } from './types';

@Injectable()
export class DlqDrizzleRepository extends DlqRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async list(query: DlqListQuery): Promise<{ records: DlqMessageRecord[]; totalCount: number }> {
    return withAdmin(this.db, mkAdminCtx('service:dlq'), async (tx) => {
      const conditions: SQL[] = [];
      if (query.originStream) conditions.push(eq(dlqMessages.originStream, query.originStream));
      if (query.status) conditions.push(eq(dlqMessages.status, query.status));
      if (query.tenantId) conditions.push(eq(dlqMessages.tenantId, query.tenantId));
      if (query.beforeId) conditions.push(sql`${dlqMessages.id} < ${query.beforeId}`);
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalResult, rows] = await Promise.all([
        tx.select({ value: sql<number>`count(*)::int` }).from(dlqMessages).where(where),
        tx.select().from(dlqMessages).where(where).orderBy(desc(dlqMessages.id)).limit(query.limit),
      ]);
      return { records: rows, totalCount: totalResult[0]?.value ?? 0 };
    });
  }

  async countPending(): Promise<number> {
    return withAdmin(this.db, mkAdminCtx('service:dlq'), async (tx) => {
      const [row] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(dlqMessages)
        .where(eq(dlqMessages.status, 'pending'));
      return row?.value ?? 0;
    });
  }

  async countSinceByStream(since: Date): Promise<DlqStreamCount[]> {
    return withAdmin(this.db, mkAdminCtx('service:dlq'), (tx) =>
      tx
        .select({ originStream: dlqMessages.originStream, count: count() })
        .from(dlqMessages)
        .where(gte(dlqMessages.createdAt, since))
        .groupBy(dlqMessages.originStream),
    );
  }

  async replay(
    id: string,
    replayedBy: string,
    beforeUpdate: (row: DlqMessageRecord) => Promise<void>,
  ): Promise<DlqTransitionResult> {
    return withAdmin(this.db, mkAdminCtx('service:dlq'), async (tx) => {
      const [row] = await tx.select().from(dlqMessages).where(eq(dlqMessages.id, id));
      if (!row) return { kind: 'not_found' };

      await beforeUpdate(row);

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
      return { kind: 'ok', row: updated };
    });
  }

  async discard(
    id: string,
    beforeUpdate: (row: DlqMessageRecord) => void,
  ): Promise<DlqTransitionResult> {
    return withAdmin(this.db, mkAdminCtx('service:dlq'), async (tx) => {
      const [row] = await tx.select().from(dlqMessages).where(eq(dlqMessages.id, id));
      if (!row) return { kind: 'not_found' };

      beforeUpdate(row);

      const [updated] = await tx
        .update(dlqMessages)
        .set({ status: 'discarded' })
        .where(eq(dlqMessages.id, id))
        .returning();
      return { kind: 'ok', row: updated };
    });
  }
}
