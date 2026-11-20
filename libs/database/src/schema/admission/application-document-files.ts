import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, smallint, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { institutes } from '../tenant/institutes';
import { applicationDocuments } from './application-documents';

/** Pages of an admission application document, in order. */
export const applicationDocumentFiles = pgTable(
  'application_document_files',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => applicationDocuments.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Page order within the document, starting at 0. */
    position: smallint('position').notNull(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
    index('application_document_files_tenant_id_idx').on(table.tenantId),
    index('application_document_files_document_id_idx').on(table.documentId),
    // Unfiltered: the file sweeper and the foreign-key check on deleting a file look up rows of any state.
    index('application_document_files_file_id_idx').on(table.fileId),
    // A file belongs to one record only.
    uniqueIndex('application_document_files_file_id_key')
      .on(table.fileId)
      .where(sql`deleted_at IS NULL`),
    ...tenantPolicies('application_document_files'),
  ],
).enableRLS();
