import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { getRequestContext } from '@roviq/request-context';
import { FileService } from './file.service';
import { ProfilePhotoRepository } from './repositories/profile-photo.repository';

const PURPOSE = 'PROFILE_PHOTO';

/**
 * A person has two pictures: the one on their own account, which only they change, and the one
 * each institute keeps of them. `fileId` null removes the picture; a replaced file is deleted in
 * the same transaction.
 */
@Injectable()
export class ProfilePhotoService {
  constructor(
    private readonly repo: ProfilePhotoRepository,
    private readonly files: FileService,
  ) {}

  /** The caller's own account picture. */
  async setOwn(fileId: string | null): Promise<void> {
    const { userId } = getRequestContext();
    if (!userId) throw new Error('User context is required');
    if (fileId) await this.files.verifyUploads([fileId], PURPOSE);

    const change = await this.repo.setOwn({ userId, fileId, purpose: PURPOSE });
    if (change === 'not_found') {
      throw new BusinessException(ErrorCode.USER_PROFILE_NOT_FOUND, 'User profile not found');
    }
  }

  /**
   * The picture the caller's institute keeps of one of its people. Runs as the institute, so
   * RLS refuses another institute's profile row and the file becomes the institute's own.
   */
  async setForInstitute(targetUserId: string, fileId: string | null): Promise<void> {
    const { userId: actorId, tenantId } = getRequestContext();
    if (!actorId || !tenantId) throw new Error('Tenant context is required');
    if (fileId) await this.files.verifyUploads([fileId], PURPOSE);

    const change = await this.repo.setForInstitute({
      tenantId,
      actorId,
      targetUserId,
      fileId,
      purpose: PURPOSE,
    });
    if (change === 'not_found') {
      throw new BusinessException(ErrorCode.USER_PROFILE_NOT_FOUND, 'User profile not found');
    }
  }
}
