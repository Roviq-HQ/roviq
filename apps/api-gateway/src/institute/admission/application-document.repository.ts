import { Inject, Injectable } from '@nestjs/common';
import type { InstituteReadAccess } from '@roviq/casl';
import {
  type AdmissionApplicationStatus,
  BusinessException,
  ErrorCode,
  type InstituteContext,
  TERMINAL_STATUSES,
  type UserDocumentType,
} from '@roviq/common-types';
import {
  admissionApplicationsLive,
  applicationDocumentFiles,
  applicationDocumentFilesLive,
  applicationDocuments,
  applicationDocumentsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  filesLive,
  withTenant,
} from '@roviq/database';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { markFilesDeleted, markFilesReady } from '../../files/file-attachment';
import { fileLiveColumns } from '../../files/repositories/file-columns';
import type { FileRecord } from '../../files/repositories/types';
import { admissionReadPredicate } from './admission-read-predicate';

export const APPLICATION_DOCUMENT_PURPOSE = 'APPLICATION_DOCUMENT';

export interface ApplicationDocumentRecord {
  id: string;
  applicationId: string;
  type: UserDocumentType;
  files: FileRecord[];
  createdAt: Date;
}

const documentColumns = {
  id: applicationDocumentsLive.id,
  applicationId: applicationDocumentsLive.applicationId,
  type: applicationDocumentsLive.type,
  createdAt: applicationDocumentsLive.createdAt,
} as const;

/** An application that reached an end state keeps its documents as they were. */
function assertOpen(status: AdmissionApplicationStatus): void {
  if (TERMINAL_STATUSES.has(status)) {
    throw new BusinessException(
      ErrorCode.APPLICATION_CLOSED,
      'Documents of a closed application cannot be changed.',
    );
  }
}

async function loadFiles(tx: DrizzleDB, documentIds: string[]): Promise<Map<string, FileRecord[]>> {
  const byDocument = new Map<string, FileRecord[]>();
  if (documentIds.length === 0) return byDocument;
  const rows = await tx
    .select({ documentId: applicationDocumentFilesLive.documentId, file: fileLiveColumns })
    .from(applicationDocumentFilesLive)
    .innerJoin(filesLive, eq(filesLive.id, applicationDocumentFilesLive.fileId))
    .where(
      and(
        inArray(applicationDocumentFilesLive.documentId, documentIds),
        eq(filesLive.status, 'READY'),
      ),
    )
    .orderBy(
      asc(applicationDocumentFilesLive.documentId),
      asc(applicationDocumentFilesLive.position),
    );
  for (const row of rows) {
    const list = byDocument.get(row.documentId) ?? [];
    list.push(row.file as FileRecord);
    byDocument.set(row.documentId, list);
  }
  return byDocument;
}

@Injectable()
export class ApplicationDocumentRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  /** Documents of an application the caller may read; APPLICATION_NOT_FOUND otherwise. */
  list(applicationId: string, access: InstituteReadAccess): Promise<ApplicationDocumentRecord[]> {
    return withTenant(this.db, access.user, async (tx) => {
      const visible = await tx
        .select({ id: admissionApplicationsLive.id })
        .from(admissionApplicationsLive)
        .where(
          and(
            eq(admissionApplicationsLive.id, applicationId),
            admissionReadPredicate(access.ability, 'Application'),
          ),
        )
        .limit(1);
      if (visible.length === 0) {
        throw new BusinessException(ErrorCode.APPLICATION_NOT_FOUND, 'Application not found');
      }
      const rows = await tx
        .select(documentColumns)
        .from(applicationDocumentsLive)
        .where(eq(applicationDocumentsLive.applicationId, applicationId))
        .orderBy(asc(applicationDocumentsLive.createdAt));
      const files = await loadFiles(
        tx,
        rows.map((row) => row.id),
      );
      return rows.map((row) => ({
        ...row,
        type: row.type as UserDocumentType,
        files: files.get(row.id) ?? [],
      }));
    });
  }

  /** Throws unless the application exists in this institute and is still open. */
  async assertOpenApplication(applicationId: string, ctx: InstituteContext): Promise<void> {
    await withTenant(this.db, ctx, (tx) => this.loadOpenApplication(tx, applicationId));
  }

  /** Saves the document and makes its verified uploads READY in one transaction. */
  add(
    ctx: InstituteContext,
    input: { applicationId: string; type: UserDocumentType; fileIds: string[] },
  ): Promise<ApplicationDocumentRecord> {
    const actorId = ctx.userId;
    return withTenant(this.db, ctx, async (tx) => {
      await this.loadOpenApplication(tx, input.applicationId);
      await markFilesReady(tx, {
        fileIds: input.fileIds,
        purpose: APPLICATION_DOCUMENT_PURPOSE,
        userId: actorId,
      });
      const [document] = await tx
        .insert(applicationDocuments)
        .values({
          tenantId: ctx.tenantId,
          applicationId: input.applicationId,
          type: input.type,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({
          id: applicationDocuments.id,
          applicationId: applicationDocuments.applicationId,
          createdAt: applicationDocuments.createdAt,
        });
      await tx.insert(applicationDocumentFiles).values(
        input.fileIds.map((fileId, position) => ({
          tenantId: ctx.tenantId,
          documentId: document.id,
          fileId,
          position,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      );
      const files = await loadFiles(tx, [document.id]);
      return { ...document, type: input.type, files: files.get(document.id) ?? [] };
    });
  }

  /** Soft-deletes the document, its page rows and its files together. */
  remove(ctx: InstituteContext, documentId: string): Promise<void> {
    const actorId = ctx.userId;
    return withTenant(this.db, ctx, async (tx) => {
      const [document] = await tx
        .select({ applicationId: applicationDocumentsLive.applicationId })
        .from(applicationDocumentsLive)
        .where(eq(applicationDocumentsLive.id, documentId))
        .limit(1);
      if (!document) {
        throw new BusinessException(ErrorCode.NOT_FOUND, 'Document not found');
      }
      await this.loadOpenApplication(tx, document.applicationId);

      const deleted = {
        deletedAt: new Date(),
        deletedBy: actorId,
        updatedBy: actorId,
      };
      const pages = await tx
        .update(applicationDocumentFiles)
        .set({ ...deleted, version: sql`${applicationDocumentFiles.version} + 1` })
        .where(
          and(
            eq(applicationDocumentFiles.documentId, documentId),
            isNull(applicationDocumentFiles.deletedAt),
          ),
        )
        .returning({ fileId: applicationDocumentFiles.fileId });
      await tx
        .update(applicationDocuments)
        .set({ ...deleted, version: sql`${applicationDocuments.version} + 1` })
        .where(
          and(eq(applicationDocuments.id, documentId), isNull(applicationDocuments.deletedAt)),
        );
      await markFilesDeleted(tx, { fileIds: pages.map((page) => page.fileId), userId: actorId });
    });
  }

  private async loadOpenApplication(tx: DrizzleDB, applicationId: string): Promise<void> {
    const [application] = await tx
      .select({ status: admissionApplicationsLive.status })
      .from(admissionApplicationsLive)
      .where(eq(admissionApplicationsLive.id, applicationId))
      .limit(1);
    if (!application) {
      throw new BusinessException(ErrorCode.APPLICATION_NOT_FOUND, 'Application not found');
    }
    assertOpen(application.status);
  }
}
