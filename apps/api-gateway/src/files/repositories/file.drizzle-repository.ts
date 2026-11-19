import { Inject, Injectable } from '@nestjs/common';
import type { FilePurpose } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  files,
  filesLive,
  leaveFilesLive,
  leavesLive,
  membershipsLive,
  mkInstituteCtx,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { FileRepository } from './file.repository';
import { fileLiveColumns } from './file-columns';
import type { CreateFileData, FileLeaveOwner, FileRecord, ProcessedImageData } from './types';

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
  width: files.width,
  height: files.height,
  variants: files.variants,
  placeholder: files.placeholder,
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
          // A person's file has no institute; RLS only lets it in for a member of this one.
          tenantId: data.subjectUserId ? null : tenantId,
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
      return tx
        .select(fileLiveColumns)
        .from(filesLive)
        .where(inArray(filesLive.id, ids)) as Promise<FileRecord[]>;
    });
  }

  async findClaimable(ids: string[], purpose: FilePurpose): Promise<FileRecord[]> {
    if (ids.length === 0) return [];
    const { tenantId, userId } = this.context();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), async (tx) => {
      return tx
        .select(fileLiveColumns)
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

  async saveProcessedImage(id: string, image: ProcessedImageData): Promise<void> {
    const { tenantId, userId } = this.context();
    await withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), async (tx) => {
      await tx
        .update(files)
        .set({ ...image, contentType: 'image/webp', updatedBy: userId })
        .where(and(eq(files.id, id), eq(files.status, 'PENDING'), isNull(files.deletedAt)));
    });
  }

  async isMemberOfCurrentTenant(userId: string): Promise<boolean> {
    const { tenantId } = this.context();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), async (tx) => {
      const rows = await tx
        .select({ id: membershipsLive.id })
        .from(membershipsLive)
        .where(eq(membershipsLive.userId, userId))
        .limit(1);
      return rows.length > 0;
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
