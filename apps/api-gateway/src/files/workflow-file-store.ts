import type { FileContentType, FilePurpose } from '@roviq/common-types';
import { type DrizzleDB, files, filesLive, mkInstituteCtx, withTenant } from '@roviq/database';
import type { StorageClient } from '@roviq/storage';
import { and, eq } from 'drizzle-orm';
import { bucketOf, storageKeyFor, variantKeyOf } from './storage-keys';

const ORIGIN = 'workflow:file-store';

export interface WorkflowFileWrite {
  tenantId: string;
  /** Chosen by the workflow, so a retried activity writes the same file again. */
  fileId: string;
  purpose: FilePurpose;
  fileName: string;
  contentType: FileContentType;
  body: Buffer;
  /** The user the workflow runs for. */
  createdBy: string;
}

/**
 * File access for Temporal activities, which run outside a request: the institute is passed
 * in and every query still runs as that institute, so RLS applies.
 */
export class WorkflowFileStore {
  constructor(
    private readonly db: DrizzleDB,
    private readonly storage: StorageClient,
  ) {}

  /** Bytes of a READY file of this institute and purpose. */
  async read(tenantId: string, fileId: string, purpose: FilePurpose): Promise<Buffer> {
    const [file] = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      tx
        .select({ objectKey: filesLive.objectKey, visibility: filesLive.visibility })
        .from(filesLive)
        .where(
          and(
            eq(filesLive.id, fileId),
            eq(filesLive.status, 'READY'),
            eq(filesLive.purpose, purpose),
          ),
        ),
    );
    if (!file) throw new Error(`File ${fileId} is not a ready ${purpose} file of this institute`);
    return this.storage.get(file.visibility === 'PUBLIC' ? 'public' : 'private', file.objectKey);
  }

  /** The medium WebP rendition of a READY image of this institute and purpose; null when absent. */
  async readImage(tenantId: string, fileId: string, purpose: FilePurpose): Promise<Buffer | null> {
    const [file] = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      tx
        .select({ objectKey: filesLive.objectKey, visibility: filesLive.visibility })
        .from(filesLive)
        .where(
          and(
            eq(filesLive.id, fileId),
            eq(filesLive.status, 'READY'),
            eq(filesLive.purpose, purpose),
          ),
        ),
    );
    if (!file) return null;
    return this.storage.get(bucketOf(file), variantKeyOf(file.objectKey, 'MD'));
  }

  /** Stores a file the server produced. Writing the same `fileId` again replaces its bytes. */
  async put(write: WorkflowFileWrite): Promise<void> {
    const objectKey = storageKeyFor(
      `institutes/${write.tenantId}`,
      write.purpose,
      write.fileId,
      write.contentType,
    );
    await this.storage.put('private', objectKey, write.body, { contentType: write.contentType });
    await withTenant(this.db, mkInstituteCtx(write.tenantId, ORIGIN), (tx) =>
      tx
        .insert(files)
        .values({
          id: write.fileId,
          tenantId: write.tenantId,
          visibility: 'PRIVATE',
          purpose: write.purpose,
          objectKey,
          originalName: write.fileName,
          contentType: write.contentType,
          sizeBytes: write.body.length,
          status: 'READY',
          uploadedBy: write.createdBy,
          createdBy: write.createdBy,
          updatedBy: write.createdBy,
        })
        .onConflictDoNothing({ target: files.id }),
    );
  }

  /**
   * Stores a file the server produced as PENDING: the caller makes it READY with
   * `markFilesReady` in the transaction that saves the record pointing at it. A retry with
   * the same `fileId` replaces the bytes and the recorded size while the file is still PENDING.
   */
  async putPending(write: WorkflowFileWrite): Promise<void> {
    const objectKey = storageKeyFor(
      `institutes/${write.tenantId}`,
      write.purpose,
      write.fileId,
      write.contentType,
    );
    await this.storage.put('private', objectKey, write.body, { contentType: write.contentType });
    await withTenant(this.db, mkInstituteCtx(write.tenantId, ORIGIN), (tx) =>
      tx
        .insert(files)
        .values({
          id: write.fileId,
          tenantId: write.tenantId,
          visibility: 'PRIVATE',
          purpose: write.purpose,
          objectKey,
          originalName: write.fileName,
          contentType: write.contentType,
          sizeBytes: write.body.length,
          status: 'PENDING',
          uploadedBy: write.createdBy,
          createdBy: write.createdBy,
          updatedBy: write.createdBy,
        })
        .onConflictDoUpdate({
          target: files.id,
          set: { sizeBytes: write.body.length, updatedBy: write.createdBy },
          setWhere: and(eq(files.status, 'PENDING'), eq(files.objectKey, objectKey)),
        }),
    );
  }
}
