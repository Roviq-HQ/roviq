import { Inject, Injectable } from '@nestjs/common';
import {
  type InstituteContext,
  NOTIFICATION_TYPE_VALUES,
  type NotificationChannel,
  type NotificationDeliveryState,
  type NotificationTypeKey,
} from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, type I18nContent, withTenant } from '@roviq/database';
import { type SQL, sql } from 'drizzle-orm';
import { NotificationDeliveryRepository } from './notification-delivery.repository';
import type { DeliveryLogEntryRecord, DeliveryLogPage, DeliveryLogQuery } from './types';

interface LogRow extends Record<string, unknown> {
  total_count: number;
  last_id: string | null;
  entry_key: string | null;
  recipient_user_id: string | null;
  type: string | null;
  at: Date | string | null;
  student_membership_id: string | null;
  student_first_name: I18nContent | null;
  student_last_name: I18nContent | null;
  recipient_first_name: I18nContent | null;
  recipient_last_name: I18nContent | null;
  relationship: string | null;
  channels:
    | {
        channel: NotificationChannel;
        state: NotificationDeliveryState;
        reason: string | null;
        at: string;
      }[]
    | null;
}

const isTypeKey = (type: string): type is NotificationTypeKey =>
  (NOTIFICATION_TYPE_VALUES as readonly string[]).includes(type);

const allOf = (parts: SQL[]): SQL => (parts.length ? sql.join(parts, sql` AND `) : sql`true`);

@Injectable()
export class NotificationDeliveryDrizzleRepository extends NotificationDeliveryRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async listLog(
    ctx: InstituteContext,
    query: DeliveryLogQuery,
    first: number,
    afterRowId: string | null,
  ): Promise<DeliveryLogPage> {
    if (query.types.length === 0) return { entries: [], totalCount: 0, hasNextPage: false };

    // Row filters: a message keeps its type and recipient on every row.
    const rowWhere: SQL[] = [
      sql`d.scope = 'institute'`,
      sql`d.tenant_id = ${ctx.tenantId}::uuid`,
      sql`d.type IN (${sql.join(
        query.types.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    ];
    if (query.recipientUserId)
      rowWhere.push(sql`d.recipient_user_id = ${query.recipientUserId}::uuid`);

    // Entry filters: decided over all channels of the message.
    const having: SQL[] = [];
    if (query.channel && query.state)
      having.push(sql`bool_or(channel::text = ${query.channel} AND state = ${query.state})`);
    else if (query.channel) having.push(sql`bool_or(channel::text = ${query.channel})`);
    else if (query.state) having.push(sql`bool_or(state = ${query.state})`);
    if (query.notDeliveredOnly) having.push(sql`NOT bool_or(state IN ('READ', 'DELIVERED'))`);
    if (query.from) having.push(sql`min(first_at) >= ${query.from.toISOString()}::timestamptz`);
    if (query.to) having.push(sql`min(first_at) <= ${query.to.toISOString()}::timestamptz`);

    const aboutWhere: SQL[] = [];
    if (query.studentId) aboutWhere.push(sql`n.data ->> 'studentId' = ${query.studentId}`);
    if (query.sessionId) aboutWhere.push(sql`n.data ->> 'sessionId' = ${query.sessionId}`);

    const cursor = afterRowId ? sql`m.last_id < ${afterRowId}::uuid` : sql`true`;

    return withTenant(this.db, ctx, async (tx) => {
      // One entry per message and recipient. The message key is the in-app notification, else
      // the flow, else the provider's message id, else the row itself.
      const result = await tx.execute<LogRow>(sql`
        WITH log_rows AS (
          SELECT d.id, d.recipient_user_id, d.notification_id, d.type, d.channel, d.status,
                 d.created_at, COALESCE(d.skip_reason, d.error_code) AS reason,
                 CASE
                   WHEN d.notification_id IS NOT NULL THEN 'n:' || d.notification_id::text
                   WHEN d.flow_id IS NOT NULL THEN 'f:' || d.flow_id
                   WHEN d.provider_message_id IS NOT NULL THEN 'p:' || d.provider_message_id
                   ELSE 'r:' || d.id::text
                 END AS entry_key
            FROM notification_deliveries d
           WHERE ${allOf(rowWhere)}
        ),
        per_channel AS (
          SELECT entry_key, recipient_user_id, channel,
                 max(id::text) AS last_id,
                 min(created_at) AS first_at,
                 min(type) AS type,
                 (array_agg(notification_id) FILTER (WHERE notification_id IS NOT NULL))[1]
                   AS notification_id,
                 (array_agg(status::text ORDER BY id DESC))[1] AS latest_status,
                 (array_agg(reason ORDER BY id DESC))[1] AS latest_reason,
                 (array_agg(created_at ORDER BY id DESC))[1] AS latest_at,
                 min(created_at) FILTER (WHERE status = 'READ') AS read_at,
                 min(created_at) FILTER (WHERE status = 'DELIVERED') AS delivered_at
            FROM log_rows
           GROUP BY entry_key, recipient_user_id, channel
        ),
        channel_state AS (
          SELECT *,
                 CASE
                   WHEN read_at IS NOT NULL THEN 'READ'
                   WHEN delivered_at IS NOT NULL THEN 'DELIVERED'
                   WHEN latest_status = 'DEFERRED' THEN 'WAITING'
                   ELSE latest_status
                 END AS state,
                 COALESCE(read_at, delivered_at, latest_at) AS state_at
            FROM per_channel
        ),
        entries AS (
          SELECT entry_key, recipient_user_id,
                 max(last_id)::uuid AS last_id,
                 min(first_at) AS at,
                 min(type) AS type,
                 (array_agg(notification_id) FILTER (WHERE notification_id IS NOT NULL))[1]
                   AS notification_id,
                 jsonb_agg(jsonb_build_object(
                   'channel', channel,
                   'state', state,
                   'reason', CASE WHEN state IN ('FAILED', 'SKIPPED', 'WAITING')
                                  THEN latest_reason END,
                   'at', state_at
                 ) ORDER BY channel) AS channels
            FROM channel_state
           GROUP BY entry_key, recipient_user_id
          HAVING ${allOf(having)}
        ),
        matched AS (
          -- Base table on purpose: the log keeps saying whom a message was about after the
          -- recipient deleted its in-app copy. allow-base-read: delivery log
          SELECT e.*, n.data ->> 'studentId' AS student_membership_id
            FROM entries e
            LEFT JOIN notifications n ON n.id = e.notification_id
           WHERE ${allOf(aboutWhere)}
        ),
        page AS (
          SELECT m.* FROM matched m WHERE ${cursor} ORDER BY m.last_id DESC LIMIT ${first + 1}
        )
        SELECT c.total_count, p.last_id, p.entry_key, p.recipient_user_id, p.type, p.at,
               p.student_membership_id, p.channels,
               st.first_name AS student_first_name, st.last_name AS student_last_name,
               rp.first_name AS recipient_first_name, rp.last_name AS recipient_last_name,
               rel.relationship
          FROM (SELECT count(*)::int AS total_count FROM matched) c
          LEFT JOIN page p ON true
          LEFT JOIN student_profiles_live sp ON sp.membership_id::text = p.student_membership_id
          LEFT JOIN tenant_user_profiles_live st
                 ON st.user_id = sp.user_id AND st.tenant_id = sp.tenant_id
          LEFT JOIN tenant_user_profiles_live rp
                 ON rp.user_id = p.recipient_user_id AND rp.tenant_id = ${ctx.tenantId}::uuid
          LEFT JOIN LATERAL (
            SELECT l.relationship::text AS relationship
              FROM student_guardian_links_live l
              JOIN guardian_profiles_live g ON g.id = l.guardian_profile_id
             WHERE l.student_profile_id = sp.id AND g.user_id = p.recipient_user_id
             LIMIT 1
          ) rel ON true
         ORDER BY p.last_id DESC
      `);

      const rows = result.rows;
      const entries = rows.flatMap((row) => (row.last_id === null ? [] : [toEntry(row)]));
      return {
        entries: entries.slice(0, first),
        totalCount: rows[0]?.total_count ?? 0,
        hasNextPage: entries.length > first,
      };
    });
  }
}

function toEntry(row: LogRow): DeliveryLogEntryRecord {
  const { last_id, entry_key, recipient_user_id, type, at, channels } = row;
  if (last_id === null || entry_key === null || recipient_user_id === null || type === null)
    throw new Error('delivery log row without an entry');
  if (at === null || channels === null) throw new Error('delivery log entry without rows');
  if (!isTypeKey(type)) throw new Error(`delivery log entry of an unknown type: ${type}`);
  return {
    lastRowId: last_id,
    entryKey: entry_key,
    type,
    at: new Date(at),
    studentMembershipId: row.student_membership_id,
    studentFirstName: row.student_first_name,
    studentLastName: row.student_last_name,
    recipientUserId: recipient_user_id,
    recipientFirstName: row.recipient_first_name,
    recipientLastName: row.recipient_last_name,
    relationship: row.relationship,
    channels: channels.map((c) => ({ ...c, at: new Date(c.at) })),
  };
}
