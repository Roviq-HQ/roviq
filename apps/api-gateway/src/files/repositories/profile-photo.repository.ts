import type {
  ProfilePhotoChange,
  SetInstituteProfilePhotoData,
  SetOwnProfilePhotoData,
} from './types';

/**
 * Each method, in one transaction: reads the current picture, attaches the new file, points the
 * profile at it and deletes the replaced file.
 */
export abstract class ProfilePhotoRepository {
  /** The user's own account picture (`user_profiles`). */
  abstract setOwn(data: SetOwnProfilePhotoData): Promise<ProfilePhotoChange>;
  /** The picture the institute keeps of a person, written as that institute. */
  abstract setForInstitute(data: SetInstituteProfilePhotoData): Promise<ProfilePhotoChange>;
}
