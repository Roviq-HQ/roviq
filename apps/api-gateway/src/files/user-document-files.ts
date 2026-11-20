import {
  type DrizzleDB,
  filesLive,
  userDocumentFiles,
  userDocumentFilesLive,
  userDocuments,
} from '@roviq/database';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { markFilesDeleted } from './file-attachment';
import { fileLiveColumns } from './repositories/file-columns';
import type { FileRecord } from './repositories/types';

/** READY pages of each document, in page order. RLS of the caller's role decides what exists. */
export async function loadUserDocumentFiles(
  tx: DrizzleDB,
  documentIds: string[],
): Promise<Map<string, FileRecord[]>> {
  const byDocument = new Map<string, FileRecord[]>();
  if (documentIds.length === 0) return byDocument;
  const rows = await tx
    .select({ documentId: userDocumentFilesLive.documentId, file: fileLiveColumns })
    .from(userDocumentFilesLive)
    .innerJoin(filesLive, eq(filesLive.id, userDocumentFilesLive.fileId))
    .where(
      and(inArray(userDocumentFilesLive.documentId, documentIds), eq(filesLive.status, 'READY')),
    )
    .orderBy(asc(userDocumentFilesLive.documentId), asc(userDocumentFilesLive.position));
  for (const row of rows) {
    const list = byDocument.get(row.documentId) ?? [];
    list.push(row.file as FileRecord);
    byDocument.set(row.documentId, list);
  }
  return byDocument;
}

/** Links files to a document in the order given. Call `markFilesReady` in the same transaction. */
export async function attachUserDocumentFiles(
  tx: DrizzleDB,
  params: { documentId: string; userId: string; fileIds: string[]; actorId: string },
): Promise<void> {
  await tx.insert(userDocumentFiles).values(
    params.fileIds.map((fileId, position) => ({
      documentId: params.documentId,
      userId: params.userId,
      fileId,
      position,
      createdBy: params.actorId,
      updatedBy: params.actorId,
    })),
  );
}

/**
 * Soft-deletes a document, its pages and their files in the caller's transaction. Returns false
 * when the document does not exist or is already removed. Objects are purged later by the sweeper.
 */
export async function removeUserDocument(
  tx: DrizzleDB,
  params: { documentId: string; actorId: string },
): Promise<boolean> {
  const deleted = { deletedAt: new Date(), deletedBy: params.actorId, updatedBy: params.actorId };
  // The document row first: its row lock makes a concurrent second removal find nothing.
  const documents = await tx
    .update(userDocuments)
    .set({ ...deleted, version: sql`${userDocuments.version} + 1` })
    .where(and(eq(userDocuments.id, params.documentId), isNull(userDocuments.deletedAt)))
    .returning({ id: userDocuments.id });
  if (documents.length === 0) return false;
  const pages = await tx
    .update(userDocumentFiles)
    .set({ ...deleted, version: sql`${userDocumentFiles.version} + 1` })
    .where(
      and(eq(userDocumentFiles.documentId, params.documentId), isNull(userDocumentFiles.deletedAt)),
    )
    .returning({ fileId: userDocumentFiles.fileId });
  await markFilesDeleted(tx, {
    fileIds: pages.map((page) => page.fileId),
    userId: params.actorId,
  });
  return true;
}
