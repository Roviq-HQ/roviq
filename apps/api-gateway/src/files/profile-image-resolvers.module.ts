import { Module } from '@nestjs/common';
import { FilesModule } from './files.module';
import {
  AdminUserDetailProfileImageResolver,
  AdminUserProfileImageResolver,
  GuardianLinkedStudentProfileImageResolver,
  GuardianProfileImageResolver,
  MyProfileProfileImageResolver,
  ResellerTeamMemberProfileImageResolver,
  ResellerUserProfileImageResolver,
  StaffProfileImageResolver,
  StudentGuardianProfileImageResolver,
  StudentProfileImageResolver,
} from './profile-image.resolver';

/** Adds `profileImage` to every GraphQL type that shows a person. */
@Module({
  imports: [FilesModule],
  providers: [
    StudentProfileImageResolver,
    StaffProfileImageResolver,
    GuardianProfileImageResolver,
    StudentGuardianProfileImageResolver,
    GuardianLinkedStudentProfileImageResolver,
    MyProfileProfileImageResolver,
    ResellerUserProfileImageResolver,
    ResellerTeamMemberProfileImageResolver,
    AdminUserProfileImageResolver,
    AdminUserDetailProfileImageResolver,
  ],
})
export class ProfileImageResolversModule {}
