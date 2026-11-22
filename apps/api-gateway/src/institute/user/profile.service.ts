/**
 * Self-service profile service (ROV-157).
 *
 * Resolves the current user's profile based on membership type:
 * - Student membership → student_profile + user_profile + academics
 * - Staff membership → staff_profile + user_profile
 * - Guardian membership → guardian_profile + user_profile + linked children
 */

import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, DefaultRoles, ErrorCode } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  membershipsLive,
  mkAdminCtx,
  mkInstituteCtx,
  phoneNumbers,
  phoneNumbersLive,
  rolesLive,
  staffProfilesLive,
  studentAcademicsLive,
  studentGuardianLinksLive,
  studentProfilesLive,
  tenantUserProfilesLive,
  userProfiles,
  userProfilesLive,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, eq, sql } from 'drizzle-orm';
import type { UpdateMyProfileInput } from './dto/update-my-profile.input';

@Injectable()
export class ProfileService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  private get tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context required');
    return tenantId;
  }

  /**
   * Detect membership type by looking up the role name, then return
   * the appropriate profile shape.
   */
  async getMyProfile(userId: string, membershipId: string) {
    const tenantId = this.tenantId;

    // Get the role associated with this membership
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

    if (!membership)
      throw new BusinessException(ErrorCode.MEMBERSHIP_NOT_FOUND, 'Membership not found');

    const role = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:profile'),
      async (tx) => {
        const rows = await tx
          .select({ name: rolesLive.name })
          .from(rolesLive)
          .where(eq(rolesLive.id, membership.roleId))
          .limit(1);
        return rows[0];
      },
    );

    const roleName = (role?.name as Record<string, string>)?.en ?? '';

    const profile = await withAdmin(this.db, mkAdminCtx('service:profile'), async (tx) => {
      const rows = await tx
        .select()
        .from(userProfilesLive)
        .where(eq(userProfilesLive.userId, userId))
        .limit(1);
      return rows[0] ?? null;
    });

    if (!profile)
      throw new BusinessException(ErrorCode.USER_PROFILE_NOT_FOUND, 'User profile not found');

    // The page shows the details "as recorded by the institute", so they come from the
    // institute's copy. The picture is the user's own account picture, which this page changes.
    const [recorded] = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:profile'),
      (tx) =>
        tx
          .select()
          .from(tenantUserProfilesLive)
          .where(
            and(
              eq(tenantUserProfilesLive.tenantId, tenantId),
              eq(tenantUserProfilesLive.userId, userId),
            ),
          )
          .limit(1),
    );
    const personal = recorded ?? profile;

    const userProfileData = {
      id: profile.id,
      userId: profile.userId,
      firstName: personal.firstName,
      lastName: personal.lastName,
      gender: personal.gender,
      dateOfBirth: personal.dateOfBirth,
      bloodGroup: personal.bloodGroup,
      nationality: personal.nationality,
      profileImageFileId: profile.profileImageFileId,
    };

    // ── Student profile ────────────────────────────────
    if (roleName === DefaultRoles.Student) {
      const studentProfile = await withTenant(
        this.db,
        mkInstituteCtx(tenantId, 'service:profile'),
        async (tx) => {
          return tx
            .select()
            .from(studentProfilesLive)
            .where(eq(studentProfilesLive.userId, userId))
            .limit(1);
        },
      );

      let academics = null;
      if (studentProfile[0]) {
        const academicRows = await withTenant(
          this.db,
          mkInstituteCtx(tenantId, 'service:profile'),
          async (tx) => {
            return tx
              .select()
              .from(studentAcademicsLive)
              .where(eq(studentAcademicsLive.studentProfileId, studentProfile[0].id))
              .limit(1);
          },
        );
        academics = academicRows[0] ?? null;
      }

      return {
        type: 'student',
        userProfile: userProfileData,
        studentProfile: studentProfile[0] ?? null,
        academics,
      };
    }

    // ── Staff profile ──────────────────────────────────
    if (roleName === DefaultRoles.Teacher) {
      const staffProfile = await withTenant(
        this.db,
        mkInstituteCtx(tenantId, 'service:profile'),
        async (tx) => {
          return tx
            .select()
            .from(staffProfilesLive)
            .where(eq(staffProfilesLive.userId, userId))
            .limit(1);
        },
      );

      return {
        type: 'staff',
        userProfile: userProfileData,
        staffProfile: staffProfile[0] ?? null,
      };
    }

    // ── Guardian profile ───────────────────────────────
    if (roleName === DefaultRoles.Parent) {
      const guardianProfile = await withTenant(
        this.db,
        mkInstituteCtx(tenantId, 'service:profile'),
        async (tx) => {
          return tx
            .select()
            .from(guardianProfilesLive)
            .where(eq(guardianProfilesLive.userId, userId))
            .limit(1);
        },
      );

      let children: Array<{
        studentProfileId: string;
        relationship: string;
        isPrimaryContact: boolean;
        firstName?: Record<string, string> | null;
        lastName?: Record<string, string> | null;
      }> = [];

      if (guardianProfile[0]) {
        // Single JOIN query instead of N+1 per child
        // The children's names as this institute records them.
        children = await withTenant(
          this.db,
          mkInstituteCtx(tenantId, 'service:profile'),
          async (tx) => {
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
                  eq(studentGuardianLinksLive.guardianProfileId, guardianProfile[0].id),
                  eq(studentProfilesLive.tenantId, tenantId),
                ),
              );
          },
        );
      }

      return {
        type: 'guardian',
        userProfile: userProfileData,
        guardianProfile: guardianProfile[0] ?? null,
        children,
      };
    }

    // Fallback
    return {
      type: 'unknown',
      userProfile: userProfileData,
    };
  }

  /**
   * Self-service update: phone, address, photo — NOT name, DOB, or identity docs.
   */
  async updateMyProfile(userId: string, input: UpdateMyProfileInput) {
    // Update user_profile fields
    const updatedProfile = await withAdmin(this.db, mkAdminCtx('service:profile'), async (tx) => {
      const rows = await tx
        .update(userProfiles)
        .set({
          ...(input.nationality != null && { nationality: input.nationality }),
          ...(input.religion != null && { religion: input.religion }),
          ...(input.motherTongue != null && { motherTongue: input.motherTongue }),
          updatedBy: userId,
        })
        .where(eq(userProfiles.userId, userId))
        .returning();

      if (rows.length === 0)
        throw new BusinessException(ErrorCode.USER_PROFILE_NOT_FOUND, 'User profile not found');
      return rows[0];
    });

    // Update phone if provided
    if (input.phone) {
      const phone = input.phone;
      await withAdmin(this.db, mkAdminCtx('service:profile'), async (tx) => {
        const existing = await tx
          .select({ id: phoneNumbersLive.id })
          .from(phoneNumbersLive)
          .where(and(eq(phoneNumbersLive.userId, userId), eq(phoneNumbersLive.isPrimary, true)))
          .limit(1);

        if (existing.length > 0) {
          await tx
            .update(phoneNumbers)
            .set({
              number: phone,
              // A typed number is unverified: a verified row must not carry it (SF-053).
              isVerified: sql`${phoneNumbers.number} = ${phone} AND ${phoneNumbers.isVerified}`,
              updatedBy: userId,
            })
            .where(eq(phoneNumbers.id, existing[0].id));
        } else {
          await tx.insert(phoneNumbers).values({
            createdBy: userId,
            updatedBy: userId,
            userId,
            countryCode: '+91',
            number: phone,
            isPrimary: true,
            label: 'personal',
          });
        }
      });
    }

    return updatedProfile;
  }
}
