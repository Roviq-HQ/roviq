import { Inject, Injectable } from '@nestjs/common';
import type { AppAbility, FilePurpose } from '@roviq/common-types';
import {
  admissionApplicationsLive,
  applicationDocumentFilesLive,
  applicationDocumentsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  files,
  filesLive,
  leaveFilesLive,
  leavesLive,
  membershipsLive,
  mkInstituteCtx,
  mkResellerCtx,
  studentProfilesLive,
  userDocumentFilesLive,
  userDocumentsLive,
  withReseller,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { admissionReadPredicate } from '../../institute/admission/admission-read-predicate';
import { studentReadPredicate } from '../../institute/student/student-read-predicate';
import { markFilesReady } from '../file-attachment';
import { FileRepository } from './file.repository';
import { fileLiveColumns } from './file-columns';
import type {
  CreateFileData,
  FileApplicationDocumentOwner,
  FileDocumentOwner,
  FileLeaveOwner,
  FileRecord,
  ProcessedImageData,
} from './types';

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

interface FileActor {
  userId: string;
  tenantId: string | null;
  resellerId: string | null;
}

@Injectable()
export class FileDrizzleRepository extends FileRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  /**
   * Runs as the caller's own database role, so RLS decides which files exist for them. A
   * reseller reaches only its own files and, read-only, those of its institutes.
   */
  private run<T>(fn: (tx: DrizzleDB, actor: FileActor) => Promise<T>): Promise<T> {
    const { scope, tenantId, resellerId, userId } = getRequestContext();
    if (scope === 'reseller' && resellerId) {
      return withReseller(this.db, mkResellerCtx(resellerId, 'repository:file'), (tx) =>
        fn(tx, { userId, tenantId: null, resellerId }),
      );
    }
    if (!tenantId) throw new Error('Tenant or reseller context is required');
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:file'), (tx) =>
      fn(tx, { userId, tenantId, resellerId: null }),
    );
  }

  async create(data: CreateFileData): Promise<FileRecord> {
    return this.run(async (tx, actor) => {
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
          tenantId: data.subjectUserId ? null : actor.tenantId,
          resellerId: actor.resellerId,
          uploadedBy: actor.userId,
          createdBy: actor.userId,
          updatedBy: actor.userId,
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
    return this.run(async (tx) => {
      return tx
        .select(fileLiveColumns)
        .from(filesLive)
        .where(inArray(filesLive.id, ids)) as Promise<FileRecord[]>;
    });
  }

  async findClaimable(ids: string[], purpose: FilePurpose): Promise<FileRecord[]> {
    if (ids.length === 0) return [];
    return this.run(async (tx, { userId }) => {
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
    return this.run(async (tx, { userId }) => {
      const rows = await tx
        .select({ value: count() })
        .from(filesLive)
        .where(and(eq(filesLive.uploadedBy, userId), eq(filesLive.status, 'PENDING')));
      return rows[0]?.value ?? 0;
    });
  }

  async markReady(ids: string[], purpose: FilePurpose): Promise<void> {
    await this.run((tx, { userId }) => markFilesReady(tx, { fileIds: ids, purpose, userId }));
  }

  async findLeaveForFile(fileId: string): Promise<FileLeaveOwner | null> {
    return this.run(async (tx) => {
      const rows = await tx
        .select({ id: leavesLive.id, tenantId: leavesLive.tenantId, userId: leavesLive.userId })
        .from(leaveFilesLive)
        .innerJoin(leavesLive, eq(leavesLive.id, leaveFilesLive.leaveId))
        .where(eq(leaveFilesLive.fileId, fileId));
      return rows[0] ?? null;
    });
  }

  async findStudentDocumentForFile(
    fileId: string,
    ability: AppAbility,
  ): Promise<FileDocumentOwner | null> {
    return this.run(async (tx) => {
      const rows = await tx
        .select({ id: userDocumentsLive.id, type: userDocumentsLive.type })
        .from(userDocumentFilesLive)
        .innerJoin(userDocumentsLive, eq(userDocumentsLive.id, userDocumentFilesLive.documentId))
        .innerJoin(studentProfilesLive, eq(studentProfilesLive.userId, userDocumentsLive.userId))
        .where(and(eq(userDocumentFilesLive.fileId, fileId), studentReadPredicate(ability, null)))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async findApplicationDocumentForFile(
    fileId: string,
    ability: AppAbility,
  ): Promise<FileApplicationDocumentOwner | null> {
    return this.run(async (tx) => {
      const rows = await tx
        .select({ id: applicationDocumentsLive.id, type: applicationDocumentsLive.type })
        .from(applicationDocumentFilesLive)
        .innerJoin(
          applicationDocumentsLive,
          eq(applicationDocumentsLive.id, applicationDocumentFilesLive.documentId),
        )
        .innerJoin(
          admissionApplicationsLive,
          eq(admissionApplicationsLive.id, applicationDocumentsLive.applicationId),
        )
        .where(
          and(
            eq(applicationDocumentFilesLive.fileId, fileId),
            admissionReadPredicate(ability, 'Application'),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async saveProcessedImage(id: string, image: ProcessedImageData): Promise<void> {
    await this.run(async (tx, { userId }) => {
      await tx
        .update(files)
        .set({ ...image, contentType: 'image/webp', updatedBy: userId })
        .where(and(eq(files.id, id), eq(files.status, 'PENDING'), isNull(files.deletedAt)));
    });
  }

  async isMemberOfCurrentTenant(userId: string): Promise<boolean> {
    return this.run(async (tx) => {
      const rows = await tx
        .select({ id: membershipsLive.id })
        .from(membershipsLive)
        .where(eq(membershipsLive.userId, userId))
        .limit(1);
      return rows.length > 0;
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.run(async (tx, { userId }) => {
      await tx
        .update(files)
        .set({ status: 'REJECTED', updatedBy: userId })
        .where(and(eq(files.id, id), eq(files.status, 'PENDING'), isNull(files.deletedAt)));
    });
  }
}
