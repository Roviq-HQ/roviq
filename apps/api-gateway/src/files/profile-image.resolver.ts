import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import {
  AdminUserDetailProfileModel,
  AdminUserProfileModel,
} from '../admin/user/models/admin-user.model';
import {
  GuardianLinkedStudentModel,
  GuardianModel,
  StudentGuardianModel,
} from '../institute/guardian/models/guardian.model';
import { StaffModel } from '../institute/staff/models/staff.model';
import { StudentModel } from '../institute/student/models/student.model';
import { UserProfileData } from '../institute/user/models/profile.model';
import { ResellerTeamMemberProfileModel } from '../reseller/team/models/reseller-team-member.model';
import { ResellerUserProfileModel } from '../reseller/user/models/reseller-user.model';
import { FileLoaders } from './file.loaders';
import { FileRefModel } from './models/file-ref.model';
import type { FileRecord } from './repositories/types';

interface WithProfileImage {
  profileImageFileId?: string | null;
}

const FIELD = {
  nullable: true,
  description: 'Profile picture. Ask for `url(variant: SM)` in lists and `MD` in headers.',
} as const;

function load(loaders: FileLoaders, person: WithProfileImage): Promise<FileRecord | null> {
  return person.profileImageFileId
    ? loaders.readyById.load(person.profileImageFileId)
    : Promise.resolve(null);
}

// One resolver per GraphQL type that shows a person: the picture is loaded the same way
// everywhere, as the caller's own database role. A subtype is its own type and needs its own.

@Resolver(() => StudentModel)
export class StudentProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}

@Resolver(() => StaffModel)
export class StaffProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}

@Resolver(() => GuardianModel)
export class GuardianProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}

@Resolver(() => StudentGuardianModel)
export class StudentGuardianProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}

@Resolver(() => GuardianLinkedStudentModel)
export class GuardianLinkedStudentProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}

@Resolver(() => UserProfileData)
export class MyProfileProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}

@Resolver(() => ResellerUserProfileModel)
export class ResellerUserProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}

@Resolver(() => ResellerTeamMemberProfileModel)
export class ResellerTeamMemberProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}

@Resolver(() => AdminUserProfileModel)
export class AdminUserProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}

@Resolver(() => AdminUserDetailProfileModel)
export class AdminUserDetailProfileImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, FIELD)
  profileImage(@Parent() person: WithProfileImage): Promise<FileRecord | null> {
    return load(this.loaders, person);
  }
}
