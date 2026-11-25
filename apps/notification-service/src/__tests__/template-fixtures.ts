import type pg from 'pg';
import { registeredTemplates } from '../delivery/whatsapp/template-submission';
import { LOCALES } from '../types/notification-type';

/** The provider account every spec's WhatsApp senders belong to. */
export const SPEC_PROVIDER_ACCOUNT = '900000000000333';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Every registry template approved under its declared category on `account`, as the sync leaves
 * them once the provider approved them (ROV-333). Shared by specs and safe to run in parallel.
 */
export async function approveRegistryTemplates(
  pool: pg.Pool,
  account = SPEC_PROVIDER_ACCOUNT,
): Promise<void> {
  for (const t of registeredTemplates()) {
    for (const language of LOCALES) {
      await pool.query(
        `INSERT INTO messaging_templates
           (provider_account_id, name, language, declared_category, approved_category,
            content_hash, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4, $5, 'APPROVED', $6, $6)
         ON CONFLICT (provider_account_id, name, language) DO UPDATE
           SET status = 'APPROVED', approved_category = excluded.approved_category,
               declared_category = excluded.declared_category, out_of_step = false`,
        [account, t.name, language, t.category, t.contentHash(language), SYSTEM_USER_ID],
      );
    }
  }
}
