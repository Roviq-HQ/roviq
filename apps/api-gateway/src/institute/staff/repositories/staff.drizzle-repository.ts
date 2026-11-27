import { Inject, Injectable } from '@nestjs/common';
import { DefaultRoles } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkInstituteCtx,
  rolesLive,
  staffProfiles,
  staffProfilesLive,
  tenantSequences,
  tenantUserProfilesLive,
  uniqueViolationConstraint,
  withTenant,
} from '@roviq/database';
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  decideMembershipEnd,
  decideMembershipRestore,
  endMembership,
  insertOrRestoreMembership,
  restoreMembership,
} from '../../../auth/membership-lifecycle';
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
  CreateStaffData,
  CreateStaffResult,
  DeletedStaffRecord,
  DeleteStaffResult,
  RestoreStaffResult,
  StaffListQuery,
  StaffProfileRow,
  StaffStatistics,
  StaffWithSignIn,
  UpdateStaffData,
  UpdateStaffResult,
} from './staff.types';

const ORIGIN = 'service:staff';
const EMPLOYEE_ID_UNIQUE = 'uq_staff_profiles_tenant_employee_id';
/** Values of the series skipped because a typed ID already holds them, before giving up. */
const MAX_SEQUENCE_SKIPS = 1000;

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

  async create(data: CreateStaffData): Promise<CreateStaffResult> {
    const { tenantId, actorId } = data;
    try {
      return await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
        const membershipId = await insertOrRestoreMembership(tx, {
          userId: data.userId,
          tenantId,
          roleId: data.roleId,
          abilities: [],
          actorId,
        });
        await ensureTenantUserProfile(tx, {
          tenantId,
          userId: data.userId,
          actorId,
          ...data.tenantProfile,
        });

        const values = {
          ...data.staff,
          userId: data.userId,
          membershipId,
          tenantId,
          createdBy: actorId,
          updatedBy: actorId,
        };
        if (data.employeeId !== null) {
          // A unique violation here rolls back the membership and profile copy with it.
          const [row] = await tx
            .insert(staffProfiles)
            .values({ ...values, employeeId: data.employeeId })
            .returning();
          return { kind: 'ok' as const, row };
        }
        return { kind: 'ok' as const, row: await insertWithSeriesId(tx, tenantId, values) };
      });
    } catch (err) {
      if (uniqueViolationConstraint(err) === EMPLOYEE_ID_UNIQUE) {
        return { kind: 'employee_id_taken' };
      }
      throw err;
    }
  }

  async isEmployeeIdTaken(tenantId: string, employeeId: string): Promise<boolean> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .select({ id: staffProfilesLive.id })
        .from(staffProfilesLive)
        .where(eq(staffProfilesLive.employeeId, employeeId))
        .limit(1);
      return Boolean(row);
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
  ): Promise<DeleteStaffResult> {
    return withTenant<DeleteStaffResult>(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [profile] = await tx
        .select({ membershipId: staffProfiles.membershipId })
        .from(staffProfiles) // allow-base-read: FOR UPDATE needs the table, not the view
        .where(and(eq(staffProfiles.id, id), isNull(staffProfiles.deletedAt)))
        .for('update');
      if (!profile) return { kind: 'not_found' };

      const decision = await decideMembershipEnd(tx, {
        membershipId: profile.membershipId,
        profileId: id,
        actorId,
      });
      if (decision !== 'keep' && decision !== 'end') return { kind: decision };

      const at = new Date();
      const [row] = await tx
        .update(staffProfiles)
        .set({ deletedAt: at, deletedBy: actorId, updatedBy: actorId, dateOfLeaving })
        .where(eq(staffProfiles.id, id))
        .returning();
      if (decision === 'end') {
        await endMembership(tx, { membershipId: profile.membershipId, actorId, at });
      }
      return { kind: 'deleted', membershipEnded: decision === 'end', row };
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

  async restore(tenantId: string, id: string, actorId: string): Promise<RestoreStaffResult> {
    try {
      return await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
        const [deleted] = await tx
          .select({ membershipId: staffProfiles.membershipId })
          .from(staffProfiles) // allow-base-read: restore looks up a trashed row
          .where(and(eq(staffProfiles.id, id), isNotNull(staffProfiles.deletedAt)))
          .for('update');
        if (!deleted) return 'not_found';
        const back = await decideMembershipRestore(tx, {
          membershipId: deleted.membershipId,
          actorId,
        });
        if (back === 'needs_full_control') return back;

        await tx
          .update(staffProfiles)
          // delete() stamps the leaving date, so restore has to clear it again.
          .set({ deletedAt: null, deletedBy: null, dateOfLeaving: null, updatedBy: actorId })
          .where(eq(staffProfiles.id, id));
        if (back === 'restore') {
          await restoreMembership(tx, { membershipId: deleted.membershipId, actorId });
        }
        return 'restored';
      });
    } catch (err) {
      if (uniqueViolationConstraint(err) === EMPLOYEE_ID_UNIQUE) return 'employee_id_taken';
      throw err;
    }
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

/**
 * Inserts the profile with the next value of the institute's employee_id series (created on
 * first use). A value a current staff member already holds, typed or committed by a create
 * racing this one, is skipped: the insert waits for that create and then does nothing.
 */
async function insertWithSeriesId(
  tx: DrizzleDB,
  tenantId: string,
  values: Omit<typeof staffProfiles.$inferInsert, 'employeeId'>,
): Promise<StaffProfileRow> {
  await tx
    .insert(tenantSequences)
    .values({
      tenantId,
      sequenceName: 'employee_id',
      currentValue: 0n,
      formatTemplate: 'EMP-{value:04d}',
    })
    .onConflictDoNothing();

  for (let attempt = 0; attempt < MAX_SEQUENCE_SKIPS; attempt++) {
    const result = await tx.execute(
      sql`SELECT * FROM next_sequence_value(${tenantId}::uuid, 'employee_id')`,
    );
    const next = result.rows[0] as { next_val: string; formatted: string };
    const [row] = await tx
      .insert(staffProfiles)
      .values({ ...values, employeeId: next.formatted || `EMP-${next.next_val}` })
      .onConflictDoNothing({
        target: [staffProfiles.tenantId, staffProfiles.employeeId],
        where: sql`${staffProfiles.deletedAt} IS NULL`,
      })
      .returning();
    if (row) return row;
  }
  throw new Error(`employee_id series of ${tenantId} has no free value`);
}
