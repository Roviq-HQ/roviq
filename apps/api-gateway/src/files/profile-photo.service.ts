import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  userProfiles,
  userProfilesLive,
  withAdmin,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { eq } from 'drizzle-orm';
import { FileService } from './file.service';
import { markFilesDeleted, markFilesReady } from './file-attachment';

const PURPOSE = 'PROFILE_PHOTO';

/**
 * Sets or clears a person's profile picture. Callers decide who may do it (update student,
 * staff, guardian or own profile) and pass a user that belongs to their own institute.
 */
@Injectable()
export class ProfilePhotoService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly files: FileService,
  ) {}

  /** `fileId` null removes the picture. The replaced file is deleted in the same transaction. */
  async set(targetUserId: string, fileId: string | null): Promise<void> {
    const { userId: actorId } = getRequestContext();
    if (fileId) await this.files.verifyUploads([fileId], PURPOSE);

    // user_profiles is shared by every institute the person belongs to, so it is written as
    // admin, like the person's name. The file must be about this very person.
    await withAdmin(this.db, mkAdminCtx('service:profile-photo'), async (tx) => {
      const [profile] = await tx
        .select({ current: userProfilesLive.profileImageFileId })
        .from(userProfilesLive)
        .where(eq(userProfilesLive.userId, targetUserId));
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
        });
      }
      await tx
        .update(userProfiles)
        .set({ profileImageFileId: fileId, updatedBy: actorId })
        .where(eq(userProfiles.userId, targetUserId));
      if (profile.current) {
        await markFilesDeleted(tx, { fileIds: [profile.current], userId: actorId });
      }
    });
  }
}
