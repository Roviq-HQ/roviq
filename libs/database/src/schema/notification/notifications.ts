import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { entityColumns, i18nText } from '../common/columns';
import {
  currentUserId,
  roviqAdmin,
  roviqApp,
  roviqReseller,
  roviqUser,
} from '../common/rls-policies';
import { resellers } from '../reseller/resellers';
import { institutes } from '../tenant/institutes';

const ownInstitute = sql`scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid`;
/** A platform notification belongs to no institute or reseller, only to its recipient. */
const ownPlatform = sql`scope = 'platform' AND recipient_user_id = ${currentUserId}`;
const ownReseller = sql`scope = 'reseller' AND reseller_id = current_setting('app.current_reseller_id', true)::uuid`;

/**
 * One in-app notification for one recipient. Written only by the notification pipeline
 * (as `roviq_admin`); request roles may read their scope's rows and set `read_at` /
 * `archived_at` (column grants in the rov-314 migration). The database isolates by
 * institute or reseller; "only your own" is the repository's filter on the token's user id.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    scope: varchar({ length: 20 }).notNull(),
    tenantId: uuid('tenant_id').references(() => institutes.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    resellerId: uuid('reseller_id').references(() => resellers.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** NULL: shown in every membership the recipient holds in this institute or reseller. */
    recipientMembershipId: uuid('recipient_membership_id'),
    /** Same key as `institute_notification_configs.notification_type`. */
    type: text().notNull(),
    title: i18nText('title').notNull(),
    body: i18nText('body').notNull(),
    /** Deep-link target and entity ids. Never a one-time code or a password. */
    data: jsonb().$type<Record<string, unknown>>(),
    /** Source event and recipient; a redelivered event must not create a second row. */
    dedupeKey: text('dedupe_key'),
    /** The delivery flow (workflow id) this row belongs to; a read or an archive ends that flow. */
    flowId: text('flow_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...entityColumns,
  },
  (table) => [
    check(
      'chk_notifications_scope',
      sql`CASE "scope"
        WHEN 'institute' THEN "tenant_id" IS NOT NULL AND "reseller_id" IS NULL
        WHEN 'reseller'  THEN "reseller_id" IS NOT NULL AND "tenant_id" IS NULL
        WHEN 'platform'  THEN "tenant_id" IS NULL AND "reseller_id" IS NULL
        ELSE false
      END`,
    ),
    // Not partial: a soft-deleted notification must stay deleted when its event is redelivered.
    uniqueIndex('notifications_dedupe_key_key').using('btree', table.dedupeKey.asc().nullsLast()),
    index('notifications_tenant_id_idx').using('btree', table.tenantId.asc().nullsLast()),
    index('notifications_recipient_inbox_idx')
      .using(
        'btree',
        table.recipientUserId.asc().nullsLast(),
        table.tenantId.asc().nullsLast(),
        table.id.desc().nullsLast(),
      )
      .where(sql`deleted_at IS NULL AND archived_at IS NULL`),
    index('notifications_recipient_unread_idx')
      .using('btree', table.recipientUserId.asc().nullsLast(), table.tenantId.asc().nullsLast())
      .where(sql`deleted_at IS NULL AND archived_at IS NULL AND read_at IS NULL`),

    pgPolicy('notifications_app_select', { for: 'select', to: roviqApp, using: ownInstitute }),
    pgPolicy('notifications_app_update', {
      for: 'update',
      to: roviqApp,
      using: ownInstitute,
      withCheck: ownInstitute,
    }),
    pgPolicy('notifications_reseller_select', {
      for: 'select',
      to: roviqReseller,
      using: ownReseller,
    }),
    pgPolicy('notifications_reseller_update', {
      for: 'update',
      to: roviqReseller,
      using: ownReseller,
      withCheck: ownReseller,
    }),
    pgPolicy('notifications_self_select', { for: 'select', to: roviqUser, using: ownPlatform }),
    pgPolicy('notifications_self_update', {
      for: 'update',
      to: roviqUser,
      using: ownPlatform,
      withCheck: ownPlatform,
    }),
    pgPolicy('notifications_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
