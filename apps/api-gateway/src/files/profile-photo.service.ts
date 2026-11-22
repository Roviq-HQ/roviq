import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
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
import { getRequestContext } from '@roviq/request-context';
import { and, eq } from 'drizzle-orm';
import { FileService } from './file.service';
import { markFilesDeleted, markFilesReady } from './file-attachment';

const PURPOSE = 'PROFILE_PHOTO';

/**
 * A person has two pictures: the one on their own account, which only they change, and the one
 * each institute keeps of them. `fileId` null removes the picture; a replaced file is deleted in
 * the same transaction.
 */
@Injectable()
export class ProfilePhotoService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly files: FileService,
  ) {}

  /** The caller's own account picture. */
  async setOwn(fileId: string | null): Promise<void> {
    const { userId } = getRequestContext();
    if (!userId) throw new Error('User context is required');
    if (fileId) await this.files.verifyUploads([fileId], PURPOSE);

    await withAdmin(this.db, mkAdminCtx('service:profile-photo'), async (tx) => {
      const [profile] = await tx
        .select({ current: userProfilesLive.profileImageFileId })
        .from(userProfilesLive)
        .where(eq(userProfilesLive.userId, userId));
      if (!profile) {
        throw new BusinessException(ErrorCode.USER_PROFILE_NOT_FOUND, 'User profile not found');
      }
      if (profile.current === fileId) return;
      if (fileId) {
        await markFilesReady(tx, {
          fileIds: [fileId],
          purpose: PURPOSE,
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
    });
  }

  /**
   * The picture the caller's institute keeps of one of its people. Runs as the institute, so
   * RLS refuses another institute's profile row and the file becomes the institute's own.
   */
  async setForInstitute(targetUserId: string, fileId: string | null): Promise<void> {
    const { userId: actorId, tenantId } = getRequestContext();
    if (!actorId || !tenantId) throw new Error('Tenant context is required');
    if (fileId) await this.files.verifyUploads([fileId], PURPOSE);

    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:profile-photo'), async (tx) => {
      const [profile] = await tx
        .select({ current: tenantUserProfilesLive.profileImageFileId })
        .from(tenantUserProfilesLive)
        .where(
          and(
            eq(tenantUserProfilesLive.tenantId, tenantId),
            eq(tenantUserProfilesLive.userId, targetUserId),
          ),
        );
      if (!profile) {
        throw new BusinessException(ErrorCode.USER_PROFILE_NOT_FOUND, 'User profile not found');
      }
      if (profile.current === fileId) return;
      if (fileId) {
        await markFilesReady(tx, {
          fileIds: [fileId],
          purpose: PURPOSE,
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
    });
  }
}
