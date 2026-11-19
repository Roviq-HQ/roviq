import { BusinessException, ErrorCode, type FilePurpose } from '@roviq/common-types';
import { type DrizzleDB, files } from '@roviq/database';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

/**
 * Moves verified uploads to READY inside the caller's transaction, so a file becomes usable
 * only together with the record that references it. Call `FileService.verifyUploads` first.
 */
export async function markFilesReady(
  tx: DrizzleDB,
  params: {
    fileIds: string[];
    purpose: FilePurpose;
    userId: string;
    /** For a person's file: the person it must be about, so one cannot be attached to another. */
    subjectUserId?: string;
  },
): Promise<void> {
  if (params.fileIds.length === 0) return;
  const rows = await tx
    .update(files)
    .set({ status: 'READY', updatedBy: params.userId, version: sql`${files.version} + 1` })
    .where(
      and(
        inArray(files.id, params.fileIds),
        // PENDING → READY is the only transition FILE_STATE_MACHINE allows into READY.
        eq(files.status, 'PENDING'),
        eq(files.purpose, params.purpose),
        eq(files.uploadedBy, params.userId),
        params.subjectUserId ? eq(files.subjectUserId, params.subjectUserId) : undefined,
        isNull(files.deletedAt),
      ),
    )
    .returning({ id: files.id });
  if (rows.length !== new Set(params.fileIds).size) {
    throw new BusinessException(
      ErrorCode.FILE_NOT_FOUND,
      'One or more files are missing or cannot be attached.',
    );
  }
}

/** Detaches files in the caller's transaction. Objects are purged later by the sweeper. */
export async function markFilesDeleted(
  tx: DrizzleDB,
  params: { fileIds: string[]; userId: string },
): Promise<void> {
  if (params.fileIds.length === 0) return;
  await tx
    .update(files)
    .set({
      status: 'DELETED',
      deletedAt: new Date(),
      deletedBy: params.userId,
      updatedBy: params.userId,
      version: sql`${files.version} + 1`,
    })
    .where(
      and(inArray(files.id, params.fileIds), eq(files.status, 'READY'), isNull(files.deletedAt)),
    );
}
