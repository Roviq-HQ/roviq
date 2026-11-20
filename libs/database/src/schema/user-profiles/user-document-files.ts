import { sql } from 'drizzle-orm';
import { index, pgTable, smallint, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { entityColumns } from '../common/columns';
import { userScopedPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { userDocuments } from './user-documents';

/**
 * Pages of a user document, in order. Platform-level like `user_documents`: readable only
 * where the user holds a membership; writes are admin-only.
 */
export const userDocumentFiles = pgTable(
  'user_document_files',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => userDocuments.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    // Copied from the document so the row-level policy needs no join.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Page order within the document, starting at 0. */
    position: smallint('position').notNull(),
    ...entityColumns,
  },
  (table) => [
    index('user_document_files_document_id_idx').on(table.documentId),
    index('user_document_files_user_id_idx').on(table.userId),
    // Unfiltered: the file sweeper and the foreign-key check on deleting a file look up rows of any state.
    index('user_document_files_file_id_idx').on(table.fileId),
    // A file belongs to one record only.
    uniqueIndex('user_document_files_file_id_key').on(table.fileId).where(sql`deleted_at IS NULL`),
    ...userScopedPolicies('user_document_files'),
  ],
).enableRLS();
