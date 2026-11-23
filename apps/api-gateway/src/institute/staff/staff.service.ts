/**
 * Staff service (ROV-157).
 *
 * Handles staff CRUD, employee_id generation, and NATS events.
 * Uses withTenant for RLS enforcement.
 */

import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, DefaultRoles, EmploymentType, ErrorCode } from '@roviq/common-types';
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
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { IdentityService } from '../../auth/identity.service';
import { ensureTenantUserProfile, updateTenantUserProfile } from '../../auth/tenant-user-profile';
import { nameStartsWith } from '../../common/name-search';
import { SignInDetailsService } from '../sign-in-details/sign-in-details.service';
import { withSignInStates } from '../sign-in-details/sign-in-status';
import { englishOrFirst, readSignInTarget } from '../sign-in-details/sign-in-target';
import type { CreateStaffInput } from './dto/create-staff.input';
import type { ListStaffFilterInput } from './dto/list-staff-filter.input';
import type { UpdateStaffInput } from './dto/update-staff.input';

@Injectable()
export class StaffService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly eventBus: EventBusService,
    private readonly identityService: IdentityService,
    private readonly signInDetails: SignInDetailsService,
  ) {}

  private get tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context required');
    return tenantId;
  }

  private get userId(): string {
    return getRequestContext().userId;
  }

  /**
   * Standard projection for the staff list and detail queries — joins
   * `staff_profiles_live` (security_invoker view that hides soft-deleted
   * rows) with the institute's `tenant_user_profiles` copy so the GraphQL StaffModel gets resolved
   * name + photo + DOB + gender on every read. Centralised so findById
   * and list select the same shape. Writes (INSERT/UPDATE RETURNING) target
   * the base `staff_profiles` table directly because RETURNING can't go
   * through a view.
   */
  private staffSelectLive() {
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

  async findById(id: string) {
    const tenantId = this.tenantId;
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff'),
      async (tx) => {
        const found = await tx
          .select(this.staffSelectLive())
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
      },
    );
    if (rows.length === 0)
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, `Staff profile ${id} not found`);
    return rows[0];
  }

  async list(filter: ListStaffFilterInput) {
    const tenantId = this.tenantId;
    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:staff'), async (tx) => {
      const conditions = [];
      if (filter.department) conditions.push(eq(staffProfilesLive.department, filter.department));
      if (filter.designation)
        conditions.push(eq(staffProfilesLive.designation, filter.designation));
      if (filter.employmentType)
        conditions.push(eq(staffProfilesLive.employmentType, filter.employmentType));
      if (filter.isClassTeacher != null)
        conditions.push(eq(staffProfilesLive.isClassTeacher, filter.isClassTeacher));
      if (filter.search) {
        conditions.push(nameStartsWith(tenantUserProfilesLive.searchVector, filter.search));
      }

      const limit = filter.first ?? 20;

      const rows = await tx
        .select(this.staffSelectLive())
        .from(staffProfilesLive)
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, staffProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, staffProfilesLive.tenantId),
          ),
        )
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(limit);
      return withSignInStates(tx, tenantId, rows);
    });
  }

  async create(input: CreateStaffInput) {
    const tenantId = this.tenantId;
    const actorId = this.userId;

    // PRD §2.3 rule 2: date_of_joining must not be in the future
    if (input.dateOfJoining) {
      const today = new Date().toISOString().split('T')[0];
      if (input.dateOfJoining > today) {
        throw new BusinessException(
          ErrorCode.VALIDATION_FAILED,
          'date_of_joining must not be in the future',
        );
      }
    }

    const suffix = crypto.randomUUID().slice(0, 12);
    const email = input.email ?? `staff-${suffix}@roviq.placeholder`;
    const username = `staff-${tenantId.slice(0, 8)}-${suffix}`;
    // Staff always get their own account: a typed number never links an existing one (SF-053).
    // It is stored as unverified contact data.
    const phone = input.phone ? { countryCode: '+91', number: input.phone } : undefined;

    const { userId: newUserId, tempPassword } = await this.identityService.createUser({
      email,
      username,
      phone,
      actorId,
    });
    const newUser = { id: newUserId };

    await this.identityService.ensureUserProfile(
      newUser.id,
      { firstName: input.firstName, lastName: input.lastName },
      actorId,
    );

    // Find teacher role using DefaultRoles constant — read via `roles_live`
    // to skip soft-deleted role rows.
    const staffRole = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff'),
      async (tx) => {
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
      },
    );

    if (staffRole.length === 0)
      throw new BusinessException(
        ErrorCode.ROLE_NOT_FOUND,
        'Teacher role not found for this institute',
      );

    // Create membership
    const newMembership = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff'),
      async (tx) => {
        const inserted = await tx
          .insert(memberships)
          .values({
            userId: newUser.id,
            tenantId,
            roleId: staffRole[0].id,
            status: 'ACTIVE',
            abilities: [],
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning({ id: memberships.id });
        await ensureTenantUserProfile(tx, {
          tenantId,
          userId: newUser.id,
          actorId,
          firstName: input.firstName,
          lastName: input.lastName,
          gender: input.gender,
          dateOfBirth: input.dateOfBirth,
        });
        return inserted;
      },
    );

    // Generate employee_id via tenant_sequences
    const employeeId = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff'),
      async (tx) => {
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
      },
    );

    // Create staff_profile
    const profile = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff'),
      async (tx) => {
        const rows = await tx
          .insert(staffProfiles)
          .values({
            userId: newUser.id,
            membershipId: newMembership[0].id,
            tenantId,
            employeeId,
            designation: input.designation ?? null,
            department: input.department ?? null,
            dateOfJoining: input.dateOfJoining ?? new Date().toISOString().split('T')[0],
            employmentType: input.employmentType ?? EmploymentType.REGULAR,
            specialization: input.specialization ?? null,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();
        return rows[0];
      },
    );

    this.eventBus.emit(EVENT_PATTERNS.STAFF.joined, {
      staffProfileId: profile.id,
      membershipId: newMembership[0].id,
      department: input.department,
      tenantId,
    });

    this.signInDetails.sendOnCreate({
      tenantId,
      userId: newUser.id,
      username,
      email: input.email,
      phone,
      firstName: englishOrFirst(input.firstName),
      lastName: englishOrFirst(input.lastName),
      tempPassword,
    });

    // Re-fetch via findById so the GraphQL StaffModel response includes the
    // joined name + photo from the institute's profile copy (StaffModel.firstName is now
    // i18nText and required).
    return this.findById(profile.id);
  }

  /** New temporary password for a staff member of this institute who has not signed in yet. */
  async resendSignInDetails(id: string): Promise<boolean> {
    const tenantId = this.tenantId;
    const target = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff'),
      async (tx) => {
        const [profile] = await tx
          .select({ userId: staffProfilesLive.userId })
          .from(staffProfilesLive)
          .where(eq(staffProfilesLive.id, id))
          .limit(1);
        return profile ? readSignInTarget(tx, tenantId, profile.userId) : null;
      },
    );
    if (!target)
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, `Staff profile ${id} not found`);
    await this.signInDetails.resend(tenantId, target, this.userId);
    return true;
  }

  async update(id: string, input: UpdateStaffInput) {
    const tenantId = this.tenantId;
    const actorId = this.userId;

    const updated = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff'),
      async (tx) => {
        // Check existence first — separate not-found from version mismatch.
        // Read through `staff_profiles_live` so soft-deleted rows are hidden
        // automatically (no explicit `isNull(deletedAt)` predicate needed).
        const existing = await tx
          .select({ id: staffProfilesLive.id })
          .from(staffProfilesLive)
          .where(eq(staffProfilesLive.id, id))
          .limit(1);
        if (existing.length === 0)
          throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, `Staff profile ${id} not found`);

        const rows = await tx
          .update(staffProfiles)
          .set({
            ...(input.designation != null && { designation: input.designation }),
            ...(input.department != null && { department: input.department }),
            ...(input.employmentType != null && { employmentType: input.employmentType }),
            ...(input.isClassTeacher != null && { isClassTeacher: input.isClassTeacher }),
            ...(input.specialization != null && { specialization: input.specialization }),
            ...(input.socialCategory != null && { socialCategory: input.socialCategory }),
            updatedBy: actorId,
            version: sql`${staffProfiles.version} + 1`,
          })
          .where(
            and(
              eq(staffProfiles.id, id),
              eq(staffProfiles.version, input.version),
              isNull(staffProfiles.deletedAt),
            ),
          )
          .returning();

        if (rows.length === 0) {
          throw new BusinessException(
            ErrorCode.CONCURRENT_MODIFICATION,
            'Staff profile was modified by another request (version mismatch)',
          );
        }
        await updateTenantUserProfile(tx, {
          tenantId,
          userId: rows[0].userId,
          actorId,
          changes: {
            ...(input.firstName != null && { firstName: input.firstName }),
            ...(input.lastName !== undefined && { lastName: input.lastName }),
            ...(input.gender != null && { gender: input.gender }),
            ...(input.dateOfBirth != null && { dateOfBirth: input.dateOfBirth }),
          },
        });
        return rows[0];
      },
    );

    // Re-fetch via findById so the GraphQL response includes the joined
    // name + photo from the institute's profile copy.
    return this.findById(updated.id);
  }

  async delete(id: string) {
    const tenantId = this.tenantId;
    const actorId = this.userId;
    const today = new Date().toISOString().split('T')[0];

    const deleted = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:staff'),
      async (tx) => {
        const rows = await tx
          .update(staffProfiles)
          .set({
            deletedAt: new Date(),
            deletedBy: actorId,
            dateOfLeaving: today,
          })
          .where(and(eq(staffProfiles.id, id), isNull(staffProfiles.deletedAt)))
          .returning();

        if (rows.length === 0)
          throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, `Staff profile ${id} not found`);
        return rows[0];
      },
    );

    this.eventBus.emit(EVENT_PATTERNS.STAFF.left, {
      staffProfileId: id,
      reason: deleted.leavingReason ?? 'deleted',
      tenantId,
    });

    return true;
  }

  async listDeleted() {
    const tenantId = this.tenantId;
    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:staff'), async (tx) => {
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

  async restore(id: string): Promise<boolean> {
    const tenantId = this.tenantId;
    const actorId = this.userId;

    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:staff'), async (tx) => {
      const rows = await tx
        .update(staffProfiles)
        // delete() stamps the leaving date, so restore has to clear it again.
        .set({ deletedAt: null, deletedBy: null, dateOfLeaving: null, updatedBy: actorId })
        .where(and(eq(staffProfiles.id, id), isNotNull(staffProfiles.deletedAt)))
        .returning({ id: staffProfiles.id });
      if (rows.length === 0) {
        throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, 'Deleted staff member not found');
      }
    });

    this.eventBus.emit(EVENT_PATTERNS.STAFF.joined, { staffProfileId: id, tenantId });
    return true;
  }

  async statistics() {
    const tenantId = this.tenantId;
    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:staff'), async (tx) => {
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
