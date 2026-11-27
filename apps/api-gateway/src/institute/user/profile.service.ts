/**
 * Self-service profile service (ROV-157).
 *
 * Resolves the current user's profile based on membership type:
 * - Student membership → student_profile + user_profile + academics
 * - Staff membership → staff_profile + user_profile
 * - Guardian membership → guardian_profile + user_profile + linked children
 */

import { Injectable } from '@nestjs/common';
import { BusinessException, DefaultRoles, ErrorCode, type SignedInUser } from '@roviq/common-types';
import { getRequestContext } from '@roviq/request-context';
import type { UpdateMyProfileInput } from './dto/update-my-profile.input';
import { ProfileRepository } from './repositories/profile.repository';

@Injectable()
export class ProfileService {
  constructor(private readonly repo: ProfileRepository) {}

  private get tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context required');
    return tenantId;
  }

  /**
   * Detect membership type by looking up the role name, then return
   * the appropriate profile shape.
   */
  async getMyProfile(user: SignedInUser, membershipId: string) {
    const userId = user.userId;
    const tenantId = this.tenantId;

    const membership = await this.repo.findMembership(tenantId, membershipId);

    if (!membership)
      throw new BusinessException(ErrorCode.MEMBERSHIP_NOT_FOUND, 'Membership not found');

    const roleNameText = await this.repo.findRoleName(tenantId, membership.roleId);

    const roleName = roleNameText?.en ?? '';

    const profile = await this.repo.findUserProfile(user);

    if (!profile)
      throw new BusinessException(ErrorCode.USER_PROFILE_NOT_FOUND, 'User profile not found');

    // The page shows the details "as recorded by the institute", so they come from the
    // institute's copy. The picture is the user's own account picture, which this page changes.
    const recorded = await this.repo.findInstituteProfile(tenantId, userId);
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
      const studentProfile = await this.repo.findStudentProfile(tenantId, userId);

      let academics = null;
      if (studentProfile) {
        academics = await this.repo.findStudentAcademics(tenantId, studentProfile.id);
      }

      return {
        type: 'student',
        userProfile: userProfileData,
        studentProfile,
        academics,
      };
    }

    // ── Staff profile ──────────────────────────────────
    if (roleName === DefaultRoles.Teacher) {
      const staffProfile = await this.repo.findStaffProfile(tenantId, userId);

      return {
        type: 'staff',
        userProfile: userProfileData,
        staffProfile,
      };
    }

    // ── Guardian profile ───────────────────────────────
    if (roleName === DefaultRoles.Parent) {
      const guardianProfile = await this.repo.findGuardianProfile(tenantId, userId);

      let children: Array<{
        studentProfileId: string;
        relationship: string;
        isPrimaryContact: boolean;
        firstName?: Record<string, string> | null;
        lastName?: Record<string, string> | null;
      }> = [];

      if (guardianProfile) {
        children = await this.repo.listGuardianChildren(tenantId, guardianProfile.id);
      }

      return {
        type: 'guardian',
        userProfile: userProfileData,
        guardianProfile,
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
  async updateMyProfile(user: SignedInUser, input: UpdateMyProfileInput) {
    const updatedProfile = await this.repo.updateOwnProfile(user, {
      ...(input.nationality != null && { nationality: input.nationality }),
      ...(input.religion != null && { religion: input.religion }),
      ...(input.motherTongue != null && { motherTongue: input.motherTongue }),
    });

    if (!updatedProfile)
      throw new BusinessException(ErrorCode.USER_PROFILE_NOT_FOUND, 'User profile not found');

    if (input.phone) {
      await this.repo.setPrimaryPhone(user, input.phone);
    }

    return updatedProfile;
  }
}
