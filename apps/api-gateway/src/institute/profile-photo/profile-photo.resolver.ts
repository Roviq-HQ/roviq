import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Resolver } from '@nestjs/graphql';
import { CurrentUser, GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { type AuthUser, BusinessException, ErrorCode } from '@roviq/common-types';
import { ProfilePhotoService } from '../../files/profile-photo.service';
import { type PersonKind, ProfilePhotoTargetRepository } from './profile-photo-target.repository';

const NOT_FOUND = {
  student: ErrorCode.STUDENT_NOT_FOUND,
  staff: ErrorCode.STAFF_NOT_FOUND,
  guardian: ErrorCode.GUARDIAN_NOT_FOUND,
} as const;

const FILE_ID_ARG = {
  type: () => ID,
  nullable: true,
  description:
    'A file uploaded with purpose PROFILE_PHOTO and `subjectUserId` of this person. Null removes the picture.',
} as const;

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class ProfilePhotoResolver {
  constructor(
    private readonly photos: ProfilePhotoService,
    private readonly targets: ProfilePhotoTargetRepository,
  ) {}

  @Mutation(() => Boolean, { description: 'Set or remove a student profile picture.' })
  @CheckAbility({ action: 'update', subject: 'Student' })
  setStudentPhoto(
    @Args('studentProfileId', { type: () => ID }, ParseUUIDPipe) id: string,
    @Args('fileId', FILE_ID_ARG, new ParseUUIDPipe({ optional: true })) fileId: string | null,
  ): Promise<boolean> {
    return this.setFor('student', id, fileId);
  }

  @Mutation(() => Boolean, { description: 'Set or remove a staff member profile picture.' })
  @CheckAbility({ action: 'update', subject: 'Staff' })
  setStaffPhoto(
    @Args('staffProfileId', { type: () => ID }, ParseUUIDPipe) id: string,
    @Args('fileId', FILE_ID_ARG, new ParseUUIDPipe({ optional: true })) fileId: string | null,
  ): Promise<boolean> {
    return this.setFor('staff', id, fileId);
  }

  @Mutation(() => Boolean, { description: 'Set or remove a guardian profile picture.' })
  @CheckAbility({ action: 'update', subject: 'Guardian' })
  setGuardianPhoto(
    @Args('guardianProfileId', { type: () => ID }, ParseUUIDPipe) id: string,
    @Args('fileId', FILE_ID_ARG, new ParseUUIDPipe({ optional: true })) fileId: string | null,
  ): Promise<boolean> {
    return this.setFor('guardian', id, fileId);
  }

  // No @CheckAbility: everyone may change their own picture.
  @Mutation(() => Boolean, { description: 'Set or remove your own profile picture.' })
  async setMyProfilePhoto(
    @CurrentUser() user: AuthUser,
    @Args('fileId', FILE_ID_ARG, new ParseUUIDPipe({ optional: true })) fileId: string | null,
  ): Promise<boolean> {
    await this.photos.set(user.userId, fileId);
    return true;
  }

  private async setFor(kind: PersonKind, profileId: string, fileId: string | null) {
    const userId = await this.targets.findUserId(kind, profileId);
    if (!userId) throw new BusinessException(NOT_FOUND[kind], 'Profile not found');
    await this.photos.set(userId, fileId);
    return true;
  }
}
