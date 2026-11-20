/**
 * Staff qualification service — structured CRUD for `staff_qualifications`.
 *
 * All reads/writes are wrapped in `withTenant()` so RLS enforces tenant
 * isolation (see `.claude/rules/tenant-isolation.md`). The table is
 * tenant-scoped via a `tenant_id` FK to `institutes`.
 */

import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode, type InstituteContext } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkInstituteCtx,
  softDelete,
  staffProfilesLive,
  staffQualifications,
  staffQualificationsLive,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { FileService } from '../../files/file.service';
import { markFilesDeleted, markFilesReady } from '../../files/file-attachment';
import type { CreateStaffQualificationInput } from './dto/create-staff-qualification.input';
import type { UpdateStaffQualificationInput } from './dto/update-staff-qualification.input';

const CERTIFICATE_PURPOSE = 'STAFF_CERTIFICATE';

@Injectable()
export class StaffQualificationService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly files: FileService,
  ) {}

  private get tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context required');
    return tenantId;
  }

  /** Returns qualifications for a staff profile, newest-first on year. */
  async listForStaff(staffProfileId: string) {
    const tenantId = this.tenantId;
    return withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff-qualification'),
      async (tx) => {
        const rows = await tx
          .select()
          .from(staffQualificationsLive)
          .where(eq(staffQualificationsLive.staffProfileId, staffProfileId))
          .orderBy(asc(staffQualificationsLive.type), asc(staffQualificationsLive.degreeName));
        return rows;
      },
    );
  }

  async create(input: CreateStaffQualificationInput) {
    const tenantId = this.tenantId;
    const actorId = getRequestContext().userId;
    const ctx = mkInstituteCtx(tenantId, 'service:staff-qualification');
    const certificateFileId = input.certificateFileId ?? null;

    const [staff] = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({ id: staffProfilesLive.id })
        .from(staffProfilesLive)
        .where(eq(staffProfilesLive.id, input.staffProfileId))
        .limit(1),
    );
    if (!staff) throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, 'Staff member not found');
    if (certificateFileId) await this.files.verifyUploads([certificateFileId], CERTIFICATE_PURPOSE);

    return withTenant(this.db, ctx, async (tx) => {
      if (certificateFileId) {
        await markFilesReady(tx, {
          fileIds: [certificateFileId],
          purpose: CERTIFICATE_PURPOSE,
          userId: actorId,
        });
      }
      const rows = await tx
        .insert(staffQualifications)
        .values({
          createdBy: actorId,
          updatedBy: actorId,
          staffProfileId: input.staffProfileId,
          tenantId,
          type: input.type,
          degreeName: input.degreeName,
          institution: input.institution ?? null,
          boardUniversity: input.boardUniversity ?? null,
          yearOfPassing: input.yearOfPassing ?? null,
          gradePercentage: input.gradePercentage ?? null,
          certificateFileId,
        })
        .returning();
      return rows[0];
    });
  }

  async update(id: string, input: UpdateStaffQualificationInput) {
    const actorId = getRequestContext().userId;
    const ctx = mkInstituteCtx(this.tenantId, 'service:staff-qualification');

    const existing = await this.findLive(ctx, id);
    // Undefined keeps the scan, null removes it, an id replaces it.
    const replacesCertificate =
      input.certificateFileId !== undefined &&
      input.certificateFileId !== existing.certificateFileId;
    const newFileId = replacesCertificate ? (input.certificateFileId ?? null) : null;
    if (newFileId) await this.files.verifyUploads([newFileId], CERTIFICATE_PURPOSE);

    return withTenant(this.db, ctx, async (tx) => {
      const patch: Partial<typeof staffQualifications.$inferInsert> = { updatedBy: actorId };
      if (input.type !== undefined) patch.type = input.type;
      if (input.degreeName !== undefined) patch.degreeName = input.degreeName;
      if (input.institution !== undefined) patch.institution = input.institution;
      if (input.boardUniversity !== undefined) patch.boardUniversity = input.boardUniversity;
      if (input.yearOfPassing !== undefined) patch.yearOfPassing = input.yearOfPassing;
      if (input.gradePercentage !== undefined) patch.gradePercentage = input.gradePercentage;
      if (replacesCertificate) {
        if (newFileId) {
          await markFilesReady(tx, {
            fileIds: [newFileId],
            purpose: CERTIFICATE_PURPOSE,
            userId: actorId,
          });
        }
        patch.certificateFileId = newFileId;
      }

      const rows = await tx
        .update(staffQualifications)
        .set(patch)
        .where(and(eq(staffQualifications.id, id), isNull(staffQualifications.deletedAt)))
        .returning();
      if (rows.length === 0) throw qualificationNotFound(id);

      if (replacesCertificate && existing.certificateFileId) {
        await markFilesDeleted(tx, { fileIds: [existing.certificateFileId], userId: actorId });
      }
      return rows[0];
    });
  }

  async delete(id: string): Promise<boolean> {
    const actorId = getRequestContext().userId;
    const ctx = mkInstituteCtx(this.tenantId, 'service:staff-qualification');
    const existing = await this.findLive(ctx, id);
    await withTenant(this.db, ctx, async (tx) => {
      await softDelete(tx, staffQualifications, id);
      if (existing.certificateFileId) {
        await markFilesDeleted(tx, { fileIds: [existing.certificateFileId], userId: actorId });
      }
    });
    return true;
  }

  private async findLive(ctx: InstituteContext, id: string) {
    const [row] = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          id: staffQualificationsLive.id,
          certificateFileId: staffQualificationsLive.certificateFileId,
        })
        .from(staffQualificationsLive)
        .where(eq(staffQualificationsLive.id, id))
        .limit(1),
    );
    if (!row) throw qualificationNotFound(id);
    return row;
  }
}

function qualificationNotFound(id: string): BusinessException {
  return new BusinessException(
    ErrorCode.STAFF_QUALIFICATION_NOT_FOUND,
    `Staff qualification ${id} not found`,
  );
}
