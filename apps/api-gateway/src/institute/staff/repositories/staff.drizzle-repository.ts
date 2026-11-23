import { Inject, Injectable } from '@nestjs/common';
import { DefaultRoles } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  memberships,
  mkInstituteCtx,
  rolesLive,
  staffProfiles,
  staffProfilesLive,
  tenantSequences,
  tenantUserProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  ensureTenantUserProfile,
  updateTenantUserProfile,
} from '../../../auth/tenant-user-profile';
import { nameStartsWith } from '../../../common/name-search';
import type { SignInTarget } from '../../sign-in-details/sign-in-details.service';
import { withSignInStates } from '../../sign-in-details/sign-in-status';
import { readSignInTarget } from '../../sign-in-details/sign-in-target';
import { StaffRepository } from './staff.repository';
import type {
  CreateStaffMembershipData,
  CreateStaffProfileData,
  DeletedStaffRecord,
  StaffListQuery,
  StaffProfileRow,
  StaffStatistics,
  StaffWithSignIn,
  UpdateStaffData,
  UpdateStaffResult,
} from './staff.types';

const ORIGIN = 'service:staff';

/**
 * Projection for the staff list and detail: `staff_profiles_live` joined with the institute's
 * `tenant_user_profiles` copy, so every read has name, photo, DOB and gender.
 */
function staffSelectLive() {
  return {
    id: staffProfilesLive.id,
    userId: staffProfilesLive.userId,
    membershipId: staffProfilesLive.membershipId,
    firstName: tenantUserProfilesLive.firstName,
    lastName: tenantUserProfilesLive.lastName,
    gender: tenantUserProfilesLive.gender,
    dateOfBirth: tenantUserProfilesLive.dateOfBirth,
    profileImageFileId: tenantUserProfilesLive.profileImageFileId,
    employeeId: staffProfilesLive.employeeId,
    designation: staffProfilesLive.designation,
    department: staffProfilesLive.department,
    dateOfJoining: staffProfilesLive.dateOfJoining,
    dateOfLeaving: staffProfilesLive.dateOfLeaving,
    employmentType: staffProfilesLive.employmentType,
    isClassTeacher: staffProfilesLive.isClassTeacher,
    socialCategory: staffProfilesLive.socialCategory,
    specialization: staffProfilesLive.specialization,
    version: staffProfilesLive.version,
    createdAt: staffProfilesLive.createdAt,
    updatedAt: staffProfilesLive.updatedAt,
  };
}

@Injectable()
export class StaffDrizzleRepository extends StaffRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findById(tenantId: string, id: string): Promise<StaffWithSignIn | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const found = await tx
        .select(staffSelectLive())
        .from(staffProfilesLive)
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, staffProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, staffProfilesLive.tenantId),
          ),
        )
        .where(eq(staffProfilesLive.id, id))
        .limit(1);
      return withSignInStates(tx, tenantId, found);
    });
    return rows[0] ?? null;
  }

  async list(tenantId: string, query: StaffListQuery): Promise<StaffWithSignIn[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const conditions = [];
      if (query.department) conditions.push(eq(staffProfilesLive.department, query.department));
      if (query.designation) conditions.push(eq(staffProfilesLive.designation, query.designation));
      if (query.employmentType)
        conditions.push(eq(staffProfilesLive.employmentType, query.employmentType));
      if (query.isClassTeacher != null)
        conditions.push(eq(staffProfilesLive.isClassTeacher, query.isClassTeacher));
      if (query.search) {
        conditions.push(nameStartsWith(tenantUserProfilesLive.searchVector, query.search));
      }

      const rows = await tx
        .select(staffSelectLive())
        .from(staffProfilesLive)
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, staffProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, staffProfilesLive.tenantId),
          ),
        )
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(query.limit);
      return withSignInStates(tx, tenantId, rows);
    });
  }

  async findTeacherRoleId(tenantId: string): Promise<string | null> {
    // `roles_live` skips soft-deleted role rows.
    const staffRole = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: rolesLive.id })
        .from(rolesLive)
        .where(
          and(
            eq(rolesLive.tenantId, tenantId),
            sql`${rolesLive.name}->>'en' = ${DefaultRoles.Teacher}`,
          ),
        )
        .limit(1);
    });
    return staffRole[0]?.id ?? null;
  }

  async createMembership(data: CreateStaffMembershipData): Promise<{ id: string }> {
    const { tenantId, actorId } = data;
    const inserted = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .insert(memberships)
        .values({
          userId: data.userId,
          tenantId,
          roleId: data.roleId,
          status: 'ACTIVE',
          abilities: [],
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({ id: memberships.id });
      await ensureTenantUserProfile(tx, {
        tenantId,
        userId: data.userId,
        actorId,
        ...data.profile,
      });
      return rows;
    });
    return inserted[0];
  }

  async nextEmployeeId(tenantId: string): Promise<string> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      await tx
        .insert(tenantSequences)
        .values({
          tenantId,
          sequenceName: 'employee_id',
          currentValue: 0n,
          formatTemplate: 'EMP-{value:04d}',
        })
        .onConflictDoNothing();

      const result = await tx.execute(
        sql`SELECT * FROM next_sequence_value(${tenantId}::uuid, 'employee_id')`,
      );
      const row = result.rows[0] as { next_val: string; formatted: string };
      return row.formatted || `EMP-${row.next_val}`;
    });
  }

  async createProfile(data: CreateStaffProfileData): Promise<StaffProfileRow> {
    return withTenant(this.db, mkInstituteCtx(data.tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .insert(staffProfiles)
        .values({
          userId: data.userId,
          membershipId: data.membershipId,
          tenantId: data.tenantId,
          employeeId: data.employeeId,
          designation: data.designation,
          department: data.department,
          dateOfJoining: data.dateOfJoining,
          employmentType: data.employmentType,
          specialization: data.specialization,
          createdBy: data.actorId,
          updatedBy: data.actorId,
        })
        .returning();
      return rows[0];
    });
  }

  async findSignInTarget(tenantId: string, id: string): Promise<SignInTarget | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [profile] = await tx
        .select({ userId: staffProfilesLive.userId })
        .from(staffProfilesLive)
        .where(eq(staffProfilesLive.id, id))
        .limit(1);
      return profile ? readSignInTarget(tx, tenantId, profile.userId) : null;
    });
  }

  async update(data: UpdateStaffData): Promise<UpdateStaffResult> {
    const { tenantId, id, actorId } = data;
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      // Checked first to tell not-found from a version mismatch.
      const existing = await tx
        .select({ id: staffProfilesLive.id })
        .from(staffProfilesLive)
        .where(eq(staffProfilesLive.id, id))
        .limit(1);
      if (existing.length === 0) return { kind: 'not_found' } as const;

      const rows = await tx
        .update(staffProfiles)
        .set({
          ...data.staff,
          updatedBy: actorId,
          version: sql`${staffProfiles.version} + 1`,
        })
        .where(
          and(
            eq(staffProfiles.id, id),
            eq(staffProfiles.version, data.version),
            isNull(staffProfiles.deletedAt),
          ),
        )
        .returning();

      if (rows.length === 0) return { kind: 'version_mismatch' } as const;
      await updateTenantUserProfile(tx, {
        tenantId,
        userId: rows[0].userId,
        actorId,
        changes: data.profile,
      });
      return { kind: 'ok', row: rows[0] } as const;
    });
  }

  async softDelete(
    tenantId: string,
    id: string,
    actorId: string,
    dateOfLeaving: string,
  ): Promise<StaffProfileRow | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .update(staffProfiles)
        .set({
          deletedAt: new Date(),
          deletedBy: actorId,
          dateOfLeaving,
        })
        .where(and(eq(staffProfiles.id, id), isNull(staffProfiles.deletedAt)))
        .returning();
      return rows[0] ?? null;
    });
  }

  async listDeleted(tenantId: string): Promise<DeletedStaffRecord[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({
          id: staffProfiles.id,
          firstName: tenantUserProfilesLive.firstName,
          lastName: tenantUserProfilesLive.lastName,
          identifier: staffProfiles.employeeId,
          deletedAt: sql<Date>`${staffProfiles.deletedAt}`.mapWith(staffProfiles.deletedAt),
        })
        .from(staffProfiles) // allow-base-read: the Deleted list shows trashed rows
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, staffProfiles.userId),
            eq(tenantUserProfilesLive.tenantId, staffProfiles.tenantId),
          ),
        )
        .where(isNotNull(staffProfiles.deletedAt))
        .orderBy(desc(staffProfiles.deletedAt));
    });
  }

  async restore(tenantId: string, id: string, actorId: string): Promise<boolean> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .update(staffProfiles)
        // delete() stamps the leaving date, so restore has to clear it again.
        .set({ deletedAt: null, deletedBy: null, dateOfLeaving: null, updatedBy: actorId })
        .where(and(eq(staffProfiles.id, id), isNotNull(staffProfiles.deletedAt)))
        .returning({ id: staffProfiles.id });
      return rows.length > 0;
    });
  }

  async statistics(tenantId: string): Promise<StaffStatistics> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [totalRow] = await tx.select({ count: count() }).from(staffProfilesLive);
      const [classTeacherRow] = await tx
        .select({ count: count() })
        .from(staffProfilesLive)
        .where(eq(staffProfilesLive.isClassTeacher, true));

      const deptRows = await tx
        .select({
          department: staffProfilesLive.department,
          count: count(),
        })
        .from(staffProfilesLive)
        .groupBy(staffProfilesLive.department);

      return {
        total: totalRow.count,
        active: totalRow.count,
        classTeachers: classTeacherRow.count,
        byDepartment: deptRows.map((r) => ({
          department: r.department ?? 'Unassigned',
          count: r.count,
        })),
      };
    });
  }
}
