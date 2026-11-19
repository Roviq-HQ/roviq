import {
  type DrizzleDB,
  filesLive,
  userDocumentFiles,
  userDocumentFilesLive,
} from '@roviq/database';
import { and, asc, eq, inArray } from 'drizzle-orm';
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
