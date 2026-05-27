import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { roviqAdmin } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';

/** Dead-lettered NATS messages — platform-admin inspect/replay (ROV-19). */
export const dlqMessages = pgTable(
  'dlq_messages',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey().notNull(),
    /** JetStream DLQ-stream sequence — unique per dead-lettered message; dedup key. */
    dlqStreamSeq: bigint('dlq_stream_seq', { mode: 'bigint' }).notNull().unique(),
    originalSubject: text('original_subject').notNull(),
    /** First subject segment, e.g. 'NOTIFICATION' — filter facet. */
    originStream: text('origin_stream').notNull(),
    payload: jsonb(),
    error: text().notNull(),
    retryCount: integer('retry_count').notNull(),
    correlationId: text('correlation_id').notNull(),
    tenantId: uuid('tenant_id').references(() => institutes.id),
    failedAt: timestamp('failed_at', { withTimezone: true }).notNull(),
    /** 'pending' | 'replayed' | 'discarded' — guarded by DLQ_STATE_MACHINE. */
    status: text().default('pending').notNull(),
    replayedAt: timestamp('replayed_at', { withTimezone: true }),
    replayedBy: uuid('replayed_by').references(() => users.id),
    replayCount: integer('replay_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('dlq_messages_status_idx').on(table.status),
    index('dlq_messages_origin_stream_idx').on(table.originStream),
    pgPolicy('dlq_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
