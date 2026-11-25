import { sql } from 'drizzle-orm';
import { boolean, pgPolicy, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { trackingColumns } from '../common/columns';
import { messageTemplateStatus } from '../common/enums';
import { roviqAdmin, roviqApp, roviqReseller } from '../common/rls-policies';

/**
 * What the provider holds of each code-defined WhatsApp template, per provider account and
 * language (ROV-333). Written only by the platform role (the sync and the provider's status
 * events); never deleted, because a template the provider holds is never deleted automatically.
 * An institute may read the rows of its own sender's account; a reseller reads none.
 */
export const messagingTemplates = pgTable(
  'messaging_templates',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    /** The provider account (`messaging_senders.provider_account_id`). */
    providerAccountId: text('provider_account_id').notNull(),
    /** The template name in the code registry, version included (`attendance_absent_v1`). */
    name: text().notNull(),
    /** `en` or `hi`, exactly as a send names it. */
    language: varchar({ length: 8 }).notNull(),
    /** The `MessageTemplateCategory` the definition declares. */
    declaredCategory: text('declared_category').notNull(),
    /** The category the provider approved it under; null until reviewed. */
    approvedCategory: text('approved_category'),
    /** Hash of what was submitted (body, category, button, examples); a change needs a new name. */
    contentHash: text('content_hash').notNull(),
    providerTemplateId: text('provider_template_id'),
    status: messageTemplateStatus().default('PENDING').notNull(),
    /** The provider's reason code for a rejection. */
    rejectedReason: text('rejected_reason'),
    /** The provider's quality score (`GREEN`, `YELLOW`, `RED`, `UNKNOWN`). */
    quality: text(),
    /** The category the provider suggests on its own review; shown, never applied. */
    suggestedCategory: text('suggested_category'),
    /**
     * The provider's text no longer matches the definition (edited at the provider, or the code
     * changed under the same name). Nothing is overwritten; it is shown and alerted.
     */
    outOfStep: boolean('out_of_step').default(false).notNull(),
    ...trackingColumns,
  },
  (table) => [
    uniqueIndex('messaging_templates_account_name_language_key').using(
      'btree',
      table.providerAccountId.asc().nullsLast(),
      table.name.asc().nullsLast(),
      table.language.asc().nullsLast(),
    ),

    // The rows of the account of the institute's own live sender.
    pgPolicy('messaging_templates_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`provider_account_id IN (
        SELECT s.provider_account_id FROM messaging_senders s
         WHERE s.scope = 'institute'
           AND s.deleted_at IS NULL
           AND s.tenant_id = current_setting('app.current_tenant_id', true)::uuid
      )`,
    }),
    // Stated, not implied: a reseller reads no template row (its grant is revoked too).
    pgPolicy('messaging_templates_reseller_none', {
      for: 'select',
      to: roviqReseller,
      using: sql`false`,
    }),
    pgPolicy('messaging_templates_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
