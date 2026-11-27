import { Inject, Injectable } from '@nestjs/common';
import type { SignedInUser } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  GUARDIAN_PROFILE_COLUMNS,
  guardianProfilesLive,
  membershipsLive,
  mkInstituteCtx,
  namedColumns,
  phoneNumbers,
  phoneNumbersLive,
  rolesLive,
  STAFF_PROFILE_COLUMNS,
  STUDENT_PROFILE_COLUMNS,
  staffProfilesLive,
  studentAcademicsLive,
  studentGuardianLinksLive,
  studentProfilesLive,
  tenantUserProfilesLive,
  userProfiles,
  userProfilesLive,
  withTenant,
  withUser,
} from '@roviq/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ProfileRepository } from './profile.repository';
import {
  type GuardianChildRecord,
  type GuardianProfileRow,
  INSTITUTE_PROFILE_COLUMNS,
  OWN_PROFILE_COLUMNS,
  type OwnProfileUpdate,
  type ProfileMembershipRecord,
  type StaffProfileRow,
  type StudentAcademicRow,
  type StudentProfileRow,
  type TenantUserProfileRow,
  type UpdatedUserProfileRow,
  type UserProfileRow,
} from './types';

@Injectable()
export class ProfileDrizzleRepository extends ProfileRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<ProfileMembershipRecord | null> {
    const membership = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:profile'),
      async (tx) => {
        const rows = await tx
          .select({ roleId: membershipsLive.roleId, userId: membershipsLive.userId })
          .from(membershipsLive)
          .where(eq(membershipsLive.id, membershipId))
          .limit(1);
        return rows[0];
      },
    );
    return membership ?? null;
  }

  async findRoleName(tenantId: string, roleId: string): Promise<Record<string, string> | null> {
    const role = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:profile'),
      async (tx) => {
        const rows = await tx
          .select({ name: rolesLive.name })
          .from(rolesLive)
          .where(eq(rolesLive.id, roleId))
          .limit(1);
        return rows[0];
      },
    );
    return role?.name ?? null;
  }

  async findUserProfile(user: SignedInUser): Promise<UserProfileRow | null> {
    return withUser(this.db, user, 'IMPERSONATOR_MAY_READ', async (tx) => {
      const rows = await tx
        .select(namedColumns(userProfilesLive, OWN_PROFILE_COLUMNS))
        .from(userProfilesLive)
        .where(eq(userProfilesLive.userId, user.userId))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async findInstituteProfile(
    tenantId: string,
    userId: string,
  ): Promise<TenantUserProfileRow | null> {
    const [recorded] = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:profile'),
      (tx) =>
        tx
          .select(namedColumns(tenantUserProfilesLive, INSTITUTE_PROFILE_COLUMNS))
          .from(tenantUserProfilesLive)
          .where(
            and(
              eq(tenantUserProfilesLive.tenantId, tenantId),
              eq(tenantUserProfilesLive.userId, userId),
            ),
          )
          .limit(1),
    );
    return recorded ?? null;
  }

  async findStudentProfile(tenantId: string, userId: string): Promise<StudentProfileRow | null> {
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:profile'),
      async (tx) => {
        return tx
          .select(namedColumns(studentProfilesLive, STUDENT_PROFILE_COLUMNS))
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.userId, userId))
          .limit(1);
      },
    );
    return rows[0] ?? null;
  }

  async findStudentAcademics(
    tenantId: string,
    studentProfileId: string,
  ): Promise<StudentAcademicRow | null> {
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:profile'),
      async (tx) => {
        return tx
          .select()
          .from(studentAcademicsLive)
          .where(eq(studentAcademicsLive.studentProfileId, studentProfileId))
          .limit(1);
      },
    );
    return rows[0] ?? null;
  }

  async findStaffProfile(tenantId: string, userId: string): Promise<StaffProfileRow | null> {
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:profile'),
      async (tx) => {
        return tx
          .select(namedColumns(staffProfilesLive, STAFF_PROFILE_COLUMNS))
          .from(staffProfilesLive)
          .where(eq(staffProfilesLive.userId, userId))
          .limit(1);
      },
    );
    return rows[0] ?? null;
  }

  async findGuardianProfile(tenantId: string, userId: string): Promise<GuardianProfileRow | null> {
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:profile'),
      async (tx) => {
        return tx
          .select(namedColumns(guardianProfilesLive, GUARDIAN_PROFILE_COLUMNS))
          .from(guardianProfilesLive)
          .where(eq(guardianProfilesLive.userId, userId))
          .limit(1);
      },
    );
    return rows[0] ?? null;
  }

  async listGuardianChildren(
    tenantId: string,
    guardianProfileId: string,
  ): Promise<GuardianChildRecord[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:profile'), async (tx) => {
      return tx
        .select({
          studentProfileId: studentGuardianLinksLive.studentProfileId,
          relationship: studentGuardianLinksLive.relationship,
          isPrimaryContact: studentGuardianLinksLive.isPrimaryContact,
          firstName: tenantUserProfilesLive.firstName,
          lastName: tenantUserProfilesLive.lastName,
        })
        .from(studentGuardianLinksLive)
        .innerJoin(
          studentProfilesLive,
          eq(studentGuardianLinksLive.studentProfileId, studentProfilesLive.id),
        )
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, studentProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, studentProfilesLive.tenantId),
          ),
        )
        .where(
          and(
            eq(studentGuardianLinksLive.guardianProfileId, guardianProfileId),
            eq(studentProfilesLive.tenantId, tenantId),
            isNull(studentGuardianLinksLive.accessRevokedAt),
          ),
        );
    });
  }

  async updateOwnProfile(
    user: SignedInUser,
    fields: OwnProfileUpdate,
  ): Promise<UpdatedUserProfileRow | null> {
    return withUser(this.db, user, 'PERSON_ONLY', async (tx) => {
      const rows = await tx
        .update(userProfiles)
        .set({ ...fields, updatedBy: user.userId })
        .where(eq(userProfiles.userId, user.userId))
        .returning(namedColumns(userProfiles, OWN_PROFILE_COLUMNS));
      return rows[0] ?? null;
    });
  }

  async setPrimaryPhone(user: SignedInUser, phone: string): Promise<void> {
    await withUser(this.db, user, 'PERSON_ONLY', async (tx) => {
      const existing = await tx
        .select({ id: phoneNumbersLive.id })
        .from(phoneNumbersLive)
        .where(and(eq(phoneNumbersLive.userId, user.userId), eq(phoneNumbersLive.isPrimary, true)))
        .limit(1);

      if (existing.length > 0) {
        await tx
          .update(phoneNumbers)
          .set({
            number: phone,
            // A typed number is unverified: a verified row must not carry it (SF-053).
            isVerified: sql`${phoneNumbers.number} = ${phone} AND ${phoneNumbers.isVerified}`,
            updatedBy: user.userId,
          })
          .where(eq(phoneNumbers.id, existing[0].id));
      } else {
        await tx.insert(phoneNumbers).values({
          createdBy: user.userId,
          updatedBy: user.userId,
          userId: user.userId,
          countryCode: '+91',
          number: phone,
          isPrimary: true,
          label: 'personal',
        });
      }
    });
  }
}
