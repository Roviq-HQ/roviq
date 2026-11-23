import { Inject, Injectable } from '@nestjs/common';
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
import { and, asc, eq, isNull } from 'drizzle-orm';
import { markFilesDeleted, markFilesReady } from '../../../files/file-attachment';
import { qualificationNotFound } from '../staff-qualification.errors';
import { StaffQualificationRepository } from './staff-qualification.repository';
import type {
  CertificateReplacement,
  CreateStaffQualificationData,
  StaffQualificationFileRef,
  StaffQualificationPatch,
  StaffQualificationRow,
  StaffQualificationWriteRow,
} from './staff-qualification.types';

const CERTIFICATE_PURPOSE = 'STAFF_CERTIFICATE';
const ORIGIN = 'service:staff-qualification';

@Injectable()
export class StaffQualificationDrizzleRepository extends StaffQualificationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async listForStaff(tenantId: string, staffProfileId: string): Promise<StaffQualificationRow[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .select()
        .from(staffQualificationsLive)
        .where(eq(staffQualificationsLive.staffProfileId, staffProfileId))
        .orderBy(asc(staffQualificationsLive.type), asc(staffQualificationsLive.degreeName));
      return rows;
    });
  }

  async staffExists(tenantId: string, staffProfileId: string): Promise<boolean> {
    const [staff] = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      tx
        .select({ id: staffProfilesLive.id })
        .from(staffProfilesLive)
        .where(eq(staffProfilesLive.id, staffProfileId))
        .limit(1),
    );
    return staff !== undefined;
  }

  async findLive(tenantId: string, id: string): Promise<StaffQualificationFileRef | null> {
    const [row] = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      tx
        .select({
          id: staffQualificationsLive.id,
          certificateFileId: staffQualificationsLive.certificateFileId,
        })
        .from(staffQualificationsLive)
        .where(eq(staffQualificationsLive.id, id))
        .limit(1),
    );
    return row ?? null;
  }

  async create(data: CreateStaffQualificationData): Promise<StaffQualificationWriteRow> {
    const { actorId, certificateFileId } = data;
    return withTenant(this.db, mkInstituteCtx(data.tenantId, ORIGIN), async (tx) => {
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
          staffProfileId: data.staffProfileId,
          tenantId: data.tenantId,
          type: data.type,
          degreeName: data.degreeName,
          institution: data.institution,
          boardUniversity: data.boardUniversity,
          yearOfPassing: data.yearOfPassing,
          gradePercentage: data.gradePercentage,
          certificateFileId,
        })
        .returning();
      return rows[0];
    });
  }

  async update(
    tenantId: string,
    id: string,
    actorId: string,
    fields: StaffQualificationPatch,
    certificate: CertificateReplacement | null,
  ): Promise<StaffQualificationWriteRow> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const patch: Partial<typeof staffQualifications.$inferInsert> = {
        updatedBy: actorId,
        ...fields,
      };
      if (certificate) {
        if (certificate.newFileId) {
          await markFilesReady(tx, {
            fileIds: [certificate.newFileId],
            purpose: CERTIFICATE_PURPOSE,
            userId: actorId,
          });
        }
        patch.certificateFileId = certificate.newFileId;
      }

      const rows = await tx
        .update(staffQualifications)
        .set(patch)
        .where(and(eq(staffQualifications.id, id), isNull(staffQualifications.deletedAt)))
        .returning();
      // Thrown inside the transaction so the file changes above roll back.
      if (rows.length === 0) throw qualificationNotFound(id);

      if (certificate?.previousFileId) {
        await markFilesDeleted(tx, { fileIds: [certificate.previousFileId], userId: actorId });
      }
      return rows[0];
    });
  }

  async softDelete(
    tenantId: string,
    id: string,
    actorId: string,
    certificateFileId: string | null,
  ): Promise<void> {
    await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      await softDelete(tx, staffQualifications, id);
      if (certificateFileId) {
        await markFilesDeleted(tx, { fileIds: [certificateFileId], userId: actorId });
      }
    });
  }
}
