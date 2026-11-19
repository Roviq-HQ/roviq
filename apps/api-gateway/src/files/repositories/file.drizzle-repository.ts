import { Inject, Injectable } from '@nestjs/common';
import type { FilePurpose } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  files,
  filesLive,
  leaveFilesLive,
  leavesLive,
  mkInstituteCtx,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { FileRepository } from './file.repository';
import type { CreateFileData, FileLeaveOwner, FileRecord } from './types';

const liveColumns = {
  id: filesLive.id,
  tenantId: filesLive.tenantId,
  resellerId: filesLive.resellerId,
  subjectUserId: filesLive.subjectUserId,
  visibility: filesLive.visibility,
  purpose: filesLive.purpose,
  objectKey: filesLive.objectKey,
  originalName: filesLive.originalName,
  contentType: filesLive.contentType,
  sizeBytes: filesLive.sizeBytes,
  status: filesLive.status,
  uploadedBy: filesLive.uploadedBy,
  createdAt: filesLive.createdAt,
} as const;

const writeReturning = {
  id: files.id,
  tenantId: files.tenantId,
  resellerId: files.resellerId,
  subjectUserId: files.subjectUserId,
  visibility: files.visibility,
  purpose: files.purpose,
  objectKey: files.objectKey,
  originalName: files.originalName,
  contentType: files.contentType,
  sizeBytes: files.sizeBytes,
  status: files.status,
  uploadedBy: files.uploadedBy,
  createdAt: files.createdAt,
} as const;

@Injectable()
export class FileDrizzleRepository extends FileRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private context(): { tenantId: string; userId: string } {
    const { tenantId, userId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return { tenantId, userId };
  }

  async create(data: CreateFileData): Promise<FileRecord> {
    const { tenantId, userId } = this.context();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), async (tx) => {
      // The id is needed before the insert because it is part of the object key.
      const generated = await tx.execute<{ id: string }>(sql`SELECT uuidv7() AS id`);
      const id = generated.rows[0]?.id;
      if (!id) throw new Error('uuidv7() returned no id');
      const rows = await tx
        .insert(files)
        .values({
          ...data,
          id,
          objectKey: data.objectKey(id),
          tenantId,
          uploadedBy: userId,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(writeReturning);
      return rows[0] as FileRecord;
    });
  }

  async findById(id: string): Promise<FileRecord | null> {
    const rows = await this.findByIds([id]);
    return rows[0] ?? null;
  }

  async findByIds(ids: string[]): Promise<FileRecord[]> {
    if (ids.length === 0) return [];
    const { tenantId } = this.context();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), async (tx) => {
      return tx.select(liveColumns).from(filesLive).where(inArray(filesLive.id, ids)) as Promise<
        FileRecord[]
      >;
    });
  }

  async findClaimable(ids: string[], purpose: FilePurpose): Promise<FileRecord[]> {
    if (ids.length === 0) return [];
    const { tenantId, userId } = this.context();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), async (tx) => {
      return tx
        .select(liveColumns)
        .from(filesLive)
        .where(
          and(
            inArray(filesLive.id, ids),
            eq(filesLive.status, 'PENDING'),
            eq(filesLive.purpose, purpose),
            eq(filesLive.uploadedBy, userId),
          ),
        ) as Promise<FileRecord[]>;
    });
  }

  async countPendingByCurrentUser(): Promise<number> {
    const { tenantId, userId } = this.context();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), async (tx) => {
      const rows = await tx
        .select({ value: count() })
        .from(filesLive)
        .where(and(eq(filesLive.uploadedBy, userId), eq(filesLive.status, 'PENDING')));
      return rows[0]?.value ?? 0;
    });
  }

  async findLeaveForFile(fileId: string): Promise<FileLeaveOwner | null> {
    const { tenantId } = this.context();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), async (tx) => {
      const rows = await tx
        .select({ id: leavesLive.id, tenantId: leavesLive.tenantId, userId: leavesLive.userId })
        .from(leaveFilesLive)
        .innerJoin(leavesLive, eq(leavesLive.id, leaveFilesLive.leaveId))
        .where(eq(leaveFilesLive.fileId, fileId));
      return rows[0] ?? null;
    });
  }

  async markRejected(id: string): Promise<void> {
    const { tenantId, userId } = this.context();
    await withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), async (tx) => {
      await tx
        .update(files)
        .set({ status: 'REJECTED', updatedBy: userId })
        .where(and(eq(files.id, id), eq(files.status, 'PENDING'), isNull(files.deletedAt)));
    });
  }
}
