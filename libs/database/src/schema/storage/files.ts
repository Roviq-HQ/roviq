import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { entityColumns } from '../common/columns';
import { filePurpose, fileStatus, fileVisibility } from '../common/enums';
import { filePolicies } from '../common/rls-policies';
import { resellers } from '../reseller/resellers';
import { institutes } from '../tenant/institutes';

/** One stored size of an image. Its object key is derived from the file's key and `name`. */
export interface StoredImageVariant {
  name: 'SM' | 'MD' | 'FULL';
  width: number;
  height: number;
  sizeBytes: number;
}

/**
 * One row per stored object. Domain tables reference `files.id`, never a URL, so RLS here is
 * what keeps one institute from reading another institute's files.
 */
export const files = pgTable(
  'files',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    /** Institute that owns the file. Null for reseller and user-level files. */
    tenantId: uuid('tenant_id').references(() => institutes.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    /** Reseller that owns the file. Null for institute and user-level files. */
    resellerId: uuid('reseller_id').references(() => resellers.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    /** Person the file is about (student, staff). Drives self-service and erasure. */
    subjectUserId: uuid('subject_user_id').references(() => users.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    visibility: fileVisibility('visibility').notNull(),
    purpose: filePurpose('purpose').notNull(),
    /** Key inside the bucket picked by `visibility`. Never contains the user's file name. */
    objectKey: text('object_key').notNull(),
    /** The user's file name, for display and the download header only. */
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** Pixels of the FULL size. Null for anything that is not an image. */
    width: integer('width'),
    height: integer('height'),
    /** Stored sizes of an image; `size_bytes` is their sum. Null for anything else. */
    variants: jsonb('variants').$type<StoredImageVariant[]>(),
    /** Tiny blurred preview as a data URI, shown while the image loads. */
    placeholder: text('placeholder'),
    status: fileStatus('status').default('PENDING').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    ...entityColumns,
  },
  (table) => [
    check(
      'chk_files_owner',
      sql`num_nonnulls(${table.tenantId}, ${table.resellerId}, ${table.subjectUserId}) >= 1
        AND num_nonnulls(${table.tenantId}, ${table.resellerId}) <= 1`,
    ),
    check('chk_files_size', sql`${table.sizeBytes} >= 0`),
    uniqueIndex('files_object_key_key').on(table.objectKey),
    // Per-institute storage usage sums.
    index('files_tenant_status_idx').on(table.tenantId, table.status),
    index('files_reseller_id_idx').on(table.resellerId),
    // The sweeper selects stale PENDING and old DELETED rows.
    index('files_status_created_at_idx').on(table.status, table.createdAt),
    // Pending-upload cap per user.
    index('files_uploaded_by_status_idx').on(table.uploadedBy, table.status),
    ...filePolicies('files'),
  ],
);
