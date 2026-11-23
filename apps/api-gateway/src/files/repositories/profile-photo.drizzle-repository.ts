import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  mkInstituteCtx,
  tenantUserProfiles,
  tenantUserProfilesLive,
  userProfiles,
  userProfilesLive,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { and, eq } from 'drizzle-orm';
import { markFilesDeleted, markFilesReady } from '../file-attachment';
import { ProfilePhotoRepository } from './profile-photo.repository';
import type {
  ProfilePhotoChange,
  SetInstituteProfilePhotoData,
  SetOwnProfilePhotoData,
} from './types';

@Injectable()
export class ProfilePhotoDrizzleRepository extends ProfilePhotoRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async setOwn({ userId, fileId, purpose }: SetOwnProfilePhotoData): Promise<ProfilePhotoChange> {
    return withAdmin(this.db, mkAdminCtx('service:profile-photo'), async (tx) => {
      const [profile] = await tx
        .select({ current: userProfilesLive.profileImageFileId })
        .from(userProfilesLive)
        .where(eq(userProfilesLive.userId, userId));
      if (!profile) return 'not_found';
      if (profile.current === fileId) return 'unchanged';
      if (fileId) {
        await markFilesReady(tx, {
          fileIds: [fileId],
          purpose,
          userId,
          subjectUserId: userId,
        });
      }
      await tx
        .update(userProfiles)
        .set({ profileImageFileId: fileId, updatedBy: userId })
        .where(eq(userProfiles.userId, userId));
      if (profile.current) {
        await markFilesDeleted(tx, { fileIds: [profile.current], userId });
      }
      return 'updated';
    });
  }

  async setForInstitute({
    tenantId,
    actorId,
    targetUserId,
    fileId,
    purpose,
  }: SetInstituteProfilePhotoData): Promise<ProfilePhotoChange> {
    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:profile-photo'), async (tx) => {
      const [profile] = await tx
        .select({ current: tenantUserProfilesLive.profileImageFileId })
        .from(tenantUserProfilesLive)
        .where(
          and(
            eq(tenantUserProfilesLive.tenantId, tenantId),
            eq(tenantUserProfilesLive.userId, targetUserId),
          ),
        );
      if (!profile) return 'not_found';
      if (profile.current === fileId) return 'unchanged';
      if (fileId) {
        await markFilesReady(tx, {
          fileIds: [fileId],
          purpose,
          userId: actorId,
          subjectUserId: targetUserId,
          claimForTenantId: tenantId,
        });
      }
      await tx
        .update(tenantUserProfiles)
        .set({ profileImageFileId: fileId, updatedBy: actorId })
        .where(
          and(
            eq(tenantUserProfiles.tenantId, tenantId),
            eq(tenantUserProfiles.userId, targetUserId),
          ),
        );
      if (profile.current) {
        await markFilesDeleted(tx, { fileIds: [profile.current], userId: actorId });
      }
      return 'updated';
    });
  }
}
