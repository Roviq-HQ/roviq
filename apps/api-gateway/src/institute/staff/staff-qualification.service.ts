/**
 * Staff qualification service — structured CRUD for `staff_qualifications`.
 *
 * All reads/writes are wrapped in `withTenant()` so RLS enforces tenant
 * isolation (see `.claude/rules/tenant-isolation.md`). The table is
 * tenant-scoped via a `tenant_id` FK to `institutes`.
 */

import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkInstituteCtx,
  softDelete,
  staffQualifications,
  staffQualificationsLive,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, eq } from 'drizzle-orm';
import type { CreateStaffQualificationInput } from './dto/create-staff-qualification.input';
import type { UpdateStaffQualificationInput } from './dto/update-staff-qualification.input';

@Injectable()
export class StaffQualificationService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

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
    return withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff-qualification'),
      async (tx) => {
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
            certificateUrl: input.certificateUrl ?? null,
          })
          .returning();
        return rows[0];
      },
    );
  }

  async update(id: string, input: UpdateStaffQualificationInput) {
    const tenantId = this.tenantId;
    return withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff-qualification'),
      async (tx) => {
        const patch: Record<string, unknown> = {};
        if (input.type !== undefined) patch.type = input.type;
        if (input.degreeName !== undefined) patch.degreeName = input.degreeName;
        if (input.institution !== undefined) patch.institution = input.institution;
        if (input.boardUniversity !== undefined) patch.boardUniversity = input.boardUniversity;
        if (input.yearOfPassing !== undefined) patch.yearOfPassing = input.yearOfPassing;
        if (input.gradePercentage !== undefined) patch.gradePercentage = input.gradePercentage;
        if (input.certificateUrl !== undefined) patch.certificateUrl = input.certificateUrl;

        patch.updatedBy = getRequestContext().userId;

        const rows = await tx
          .update(staffQualifications)
          .set(patch)
          .where(and(eq(staffQualifications.id, id)))
          .returning();

        if (rows.length === 0) {
          throw new BusinessException(
            ErrorCode.STAFF_QUALIFICATION_NOT_FOUND,
            `Staff qualification ${id} not found`,
          );
        }
        return rows[0];
      },
    );
  }

  async delete(id: string): Promise<boolean> {
    await withTenant(
      this.db,
      mkInstituteCtx(this.tenantId, 'service:staff-qualification'),
      async (tx) => {
        const [live] = await tx
          .select({ id: staffQualificationsLive.id })
          .from(staffQualificationsLive)
          .where(eq(staffQualificationsLive.id, id))
          .limit(1);
        if (!live) {
          throw new BusinessException(
            ErrorCode.STAFF_QUALIFICATION_NOT_FOUND,
            `Staff qualification ${id} not found`,
          );
        }
        await softDelete(tx, staffQualifications, id);
      },
    );
    return true;
  }
}
