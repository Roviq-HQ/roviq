import type { FilePurpose, FileStatus, FileVisibility, SyntheticOrigin } from '@roviq/common-types';
import {
  applicationDocumentFiles,
  type DrizzleDB,
  exportReports,
  files,
  instituteBranding,
  instituteGroupBranding,
  issuedCertificates,
  leaveFiles,
  mkAdminCtx,
  resellers,
  SYSTEM_USER_ID,
  staffQualifications,
  tcRegister,
  tenantUserProfiles,
  userDocumentFiles,
  userProfiles,
  withAdmin,
} from '@roviq/database';
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

/** An upload nobody attached is removed after this long. */
export const PENDING_UPLOAD_TTL_HOURS = 24;
/** A refused upload's row (and anything left of its objects) is removed after this long. */
export const REJECTED_UPLOAD_TTL_HOURS = 24;
/** A deleted file can still be restored by hand for this long; then it is gone for good. */
export const DELETED_FILE_GRACE_DAYS = 30;

/** An uploaded import sheet and its error report are working files; they are retired after this long. */
export const BULK_IMPORT_FILE_RETENTION_DAYS = 30;
/** A READY file that nothing uses is retired once it has been unused for at least this long. */
export const UNUSED_FILE_GRACE_HOURS = 24;

/**
 * How the sweeper decides that a READY file is no longer needed. Every purpose must be
 * listed: a new purpose does not compile until someone decides this for it.
 * - `REFERENCED`: needed while a record points at it (see `referenced`).
 * - `TIMED`: needed for a fixed time after it was written.
 */
export const FILE_RETIREMENT: { readonly [P in FilePurpose]: 'REFERENCED' | 'TIMED' } = {
  LEAVE_ATTACHMENT: 'REFERENCED',
  USER_DOCUMENT: 'REFERENCED',
  APPLICATION_DOCUMENT: 'REFERENCED',
  STAFF_CERTIFICATE: 'REFERENCED',
  PROFILE_PHOTO: 'REFERENCED',
  RESELLER_LOGO: 'REFERENCED',
  RESELLER_FAVICON: 'REFERENCED',
  INSTITUTE_LOGO: 'REFERENCED',
  INSTITUTE_FAVICON: 'REFERENCED',
  INSTITUTE_COVER: 'REFERENCED',
  BULK_IMPORT_CSV: 'TIMED',
  BULK_IMPORT_REPORT: 'TIMED',
  COMPLIANCE_EXPORT: 'REFERENCED',
  TC_PDF: 'REFERENCED',
  CERTIFICATE_PDF: 'REFERENCED',
};

function purposesRetiredBy(rule: 'REFERENCED' | 'TIMED'): FilePurpose[] {
  return (Object.keys(FILE_RETIREMENT) as FilePurpose[]).filter(
    (purpose) => FILE_RETIREMENT[purpose] === rule,
  );
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Which leftover a sweep run is collecting. */
export type SweepSelection = 'pending' | 'rejected' | 'deleted';

/** What the purge needs to know about a file to remove its objects and its row. */
export interface PurgeCandidate {
  id: string;
  objectKey: string;
  visibility: FileVisibility;
  status: FileStatus;
}

const candidateColumns = {
  id: files.id,
  objectKey: files.objectKey,
  visibility: files.visibility,
  status: files.status,
} as const;

// Reads the base table on purpose: DELETED rows are not in files_live.
function staleFilter(selection: SweepSelection, now: Date) {
  if (selection === 'pending') {
    return and(
      eq(files.status, 'PENDING'),
      lt(files.createdAt, new Date(now.getTime() - PENDING_UPLOAD_TTL_HOURS * HOUR_MS)),
    );
  }
  if (selection === 'rejected') {
    return and(
      eq(files.status, 'REJECTED'),
      lt(files.updatedAt, new Date(now.getTime() - REJECTED_UPLOAD_TTL_HOURS * HOUR_MS)),
    );
  }
  return and(
    eq(files.status, 'DELETED'),
    isNotNull(files.deletedAt),
    lt(files.deletedAt, new Date(now.getTime() - DELETED_FILE_GRACE_DAYS * DAY_MS)),
  );
}

/**
 * True while a record that is not itself deleted still uses the file. Such a file must
 * never lose its objects, whatever its status says.
 */
function inUse(fileId: typeof files.id) {
  const one = sql`1`;
  return or(
    exists(
      sql`(select ${one} from ${leaveFiles} where ${leaveFiles.fileId} = ${fileId} and ${leaveFiles.deletedAt} is null)`,
    ),
    exists(
      sql`(select ${one} from ${applicationDocumentFiles} where ${applicationDocumentFiles.fileId} = ${fileId} and ${applicationDocumentFiles.deletedAt} is null)`,
    ),
    exists(
      sql`(select ${one} from ${userDocumentFiles} where ${userDocumentFiles.fileId} = ${fileId} and ${userDocumentFiles.deletedAt} is null)`,
    ),
    exists(
      sql`(select ${one} from ${exportReports} where ${exportReports.fileId} = ${fileId} and ${exportReports.deletedAt} is null)`,
    ),
    exists(
      sql`(select ${one} from ${tcRegister} where ${tcRegister.pdfFileId} = ${fileId} and ${tcRegister.deletedAt} is null)`,
    ),
    exists(
      sql`(select ${one} from ${issuedCertificates} where ${issuedCertificates.pdfFileId} = ${fileId} and ${issuedCertificates.deletedAt} is null)`,
    ),
    exists(
      sql`(select ${one} from ${instituteBranding} where ${fileId} in (${instituteBranding.logoFileId}, ${instituteBranding.faviconFileId}, ${instituteBranding.coverImageFileId}))`,
    ),
    exists(
      sql`(select ${one} from ${instituteGroupBranding} where ${fileId} in (${instituteGroupBranding.logoFileId}, ${instituteGroupBranding.faviconFileId}))`,
    ),
  );
}

/** `inUse`, plus the records that point at a file with a nullable column. */
function referenced(fileId: typeof files.id) {
  const one = sql`1`;
  return or(
    inUse(fileId),
    exists(
      sql`(select ${one} from ${userProfiles} where ${userProfiles.profileImageFileId} = ${fileId})`,
    ),
    exists(
      sql`(select ${one} from ${tenantUserProfiles} where ${tenantUserProfiles.profileImageFileId} = ${fileId})`,
    ),
    exists(
      sql`(select ${one} from ${resellers} where ${fileId} in (${resellers.logoFileId}, ${resellers.faviconFileId}))`,
    ),
    exists(
      sql`(select ${one} from ${staffQualifications} where ${staffQualifications.certificateFileId} = ${fileId} and ${staffQualifications.deletedAt} is null)`,
    ),
  );
}

/**
 * Hard deletes of `files` rows, across every institute. Only `roviq_admin` may delete a
 * file row (policy `files_admin_all`), so every query here runs as that role. Callers are
 * the sweeper workflow and `FileService.purge`; nothing request-scoped may reach this class
 * with ids a user supplied.
 */
export class FilePurgeRepository {
  constructor(
    private readonly db: DrizzleDB,
    private readonly origin: SyntheticOrigin,
  ) {}

  /**
   * Marks READY files that are no longer needed as DELETED, which starts their grace period:
   * working files past their retention time, and files no record points at any more (a
   * safety net for a code path that dropped a file without marking it). Returns the ids.
   */
  async retireUnneeded(now: Date, limit: number): Promise<{ timed: string[]; unused: string[] }> {
    const retire = (filter: ReturnType<typeof and>) =>
      withAdmin(this.db, mkAdminCtx(this.origin), async (tx) => {
        const picked = tx
          .select({ id: files.id })
          .from(files) // allow-base-read: DELETED and REJECTED rows are not in files_live
          .where(and(eq(files.status, 'READY'), isNull(files.deletedAt), filter))
          .orderBy(asc(files.createdAt), asc(files.id))
          .limit(limit)
          .for('update', { skipLocked: true });
        const rows = await tx
          .update(files)
          .set({
            status: 'DELETED',
            deletedAt: now,
            deletedBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
            version: sql`${files.version} + 1`,
          })
          .where(and(inArray(files.id, picked), eq(files.status, 'READY')))
          .returning({ id: files.id });
        return rows.map((row) => row.id);
      });

    const timed = await retire(
      and(
        inArray(files.purpose, purposesRetiredBy('TIMED')),
        lt(files.createdAt, new Date(now.getTime() - BULK_IMPORT_FILE_RETENTION_DAYS * DAY_MS)),
      ),
    );
    const unused = await retire(
      and(
        inArray(files.purpose, purposesRetiredBy('REFERENCED')),
        lt(files.updatedAt, new Date(now.getTime() - UNUSED_FILE_GRACE_HOURS * HOUR_MS)),
        sql`not ${referenced(files.id)}`,
      ),
    );
    return { timed, unused };
  }

  /** Oldest leftovers of one kind, skipping files a live record still uses. */
  async findStale(
    selection: SweepSelection,
    now: Date,
    limit: number,
    skipIds: string[] = [],
  ): Promise<PurgeCandidate[]> {
    return withAdmin(this.db, mkAdminCtx(this.origin), (tx) =>
      tx
        .select(candidateColumns)
        .from(files) // allow-base-read: DELETED and REJECTED rows are not in files_live
        .where(
          and(
            staleFilter(selection, now),
            sql`not ${referenced(files.id)}`,
            skipIds.length > 0 ? notInArray(files.id, skipIds) : undefined,
          ),
        )
        .orderBy(asc(files.createdAt), asc(files.id))
        .limit(limit),
    );
  }

  /** Files of any status and age, for an immediate purge. Unknown ids are left out. */
  async findByIds(fileIds: string[]): Promise<PurgeCandidate[]> {
    if (fileIds.length === 0) return [];
    return withAdmin(this.db, mkAdminCtx(this.origin), (tx) =>
      tx
        .select(candidateColumns)
        .from(files) // allow-base-read: DELETED and REJECTED rows are not in files_live
        .where(inArray(files.id, fileIds)),
    );
  }

  /** Whether a live record still uses the file. Checked before any object is removed. */
  async isInUse(fileId: string): Promise<boolean> {
    return withAdmin(this.db, mkAdminCtx(this.origin), async (tx) => {
      const rows = await tx
        .select({ id: files.id })
        .from(files) // allow-base-read: DELETED and REJECTED rows are not in files_live
        .where(and(eq(files.id, fileId), referenced(files.id)));
      return rows.length > 0;
    });
  }

  /**
   * Takes a stale PENDING upload out of reach before its objects go: once REJECTED it can
   * no longer be attached, so a form submitted during the sweep fails cleanly instead of
   * attaching a file with no object. False when someone attached it first.
   */
  async rejectPending(fileId: string): Promise<boolean> {
    return withAdmin(this.db, mkAdminCtx(this.origin), async (tx) => {
      const rows = await tx
        .update(files)
        .set({ status: 'REJECTED', updatedBy: SYSTEM_USER_ID, version: sql`${files.version} + 1` })
        .where(and(eq(files.id, fileId), eq(files.status, 'PENDING'), isNull(files.deletedAt)))
        .returning({ id: files.id });
      return rows.length > 0;
    });
  }

  /**
   * Removes the row, and first the already-deleted link rows that still point at it (their
   * foreign keys are RESTRICT). Call only after the objects are gone. `status` must still be
   * what the caller saw. Returns false when the row changed or is in use again; it is then
   * left for the next run.
   */
  async removeRow(fileId: string, status: FileStatus): Promise<boolean> {
    return withAdmin(this.db, mkAdminCtx(this.origin), async (tx) => {
      const locked = await tx
        .select({ id: files.id })
        .from(files) // allow-base-read: DELETED and REJECTED rows are not in files_live
        .where(
          and(eq(files.id, fileId), eq(files.status, status), sql`not ${referenced(files.id)}`),
        )
        .for('update');
      if (locked.length === 0) return false;

      await tx
        .delete(leaveFiles)
        .where(and(eq(leaveFiles.fileId, fileId), isNotNull(leaveFiles.deletedAt)));
      await tx
        .delete(applicationDocumentFiles)
        .where(
          and(
            eq(applicationDocumentFiles.fileId, fileId),
            isNotNull(applicationDocumentFiles.deletedAt),
          ),
        );
      await tx
        .delete(userDocumentFiles)
        .where(and(eq(userDocumentFiles.fileId, fileId), isNotNull(userDocumentFiles.deletedAt)));
      const removed = await tx
        .delete(files)
        .where(and(eq(files.id, fileId), eq(files.status, status)))
        .returning({ id: files.id });
      return removed.length > 0;
    });
  }
}
