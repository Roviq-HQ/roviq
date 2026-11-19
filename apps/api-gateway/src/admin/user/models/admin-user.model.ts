import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { AddressType, Gender, MembershipStatus, UserDocumentType } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { DateOnlyScalar, DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import { createConnectionType } from '../../../common/pagination/relay-pagination.model';
import { UserIdentifierType } from '../../../user-profile/user-profile-enums';

/** GraphQL enum mirroring the database `UserStatus` pgEnum */
export enum UserStatusEnum {
  /** User can log in and access all permitted features */
  ACTIVE = 'ACTIVE',
  /** Temporarily blocked by a platform admin — cannot log in, data preserved */
  SUSPENDED = 'SUSPENDED',
  /** Auto-locked after too many failed login attempts — requires admin unlock */
  LOCKED = 'LOCKED',
}

registerEnumType(UserStatusEnum, { name: 'UserStatus' });

registerEnumType(MembershipStatus, {
  name: 'MembershipStatus',
  description: 'Membership lifecycle state within an institute.',
});

registerEnumType(AddressType, {
  name: 'AddressType',
  description: 'Which of a user’s addresses this is: permanent, current or emergency.',
});

@ObjectType({ description: 'User profile snapshot returned in admin user listings' })
export class AdminUserProfileModel {
  @Field(() => I18nTextScalar)
  firstName!: I18nContent;

  @Field(() => I18nTextScalar, { nullable: true })
  lastName?: I18nContent | null;

  /** Not a GraphQL field: `profileImage` is resolved from it (profileImageResolverFor). */
  profileImageFileId?: string | null;
}

@ObjectType({ description: 'Full profile shown on the admin user detail page' })
export class AdminUserDetailProfileModel extends AdminUserProfileModel {
  @Field(() => Gender, { nullable: true })
  gender?: Gender | null;

  @Field(() => DateOnlyScalar, { nullable: true })
  dateOfBirth?: string | null;

  @Field(() => String, { nullable: true })
  nationality?: string | null;
}

@ObjectType({ description: 'A phone number with its country dialling code' })
export class AdminUserPhoneModel {
  @Field({ description: 'Dialling code without the plus sign, e.g. "91"' })
  countryCode!: string;

  @Field()
  number!: string;
}

@ObjectType({
  description: 'Membership record showing which institute a user belongs to and in what role',
})
export class AdminUserMembershipModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  tenantId!: string;

  @Field(() => ID)
  roleId!: string;

  @Field(() => I18nTextScalar, {
    nullable: true,
    description: 'Name of the role this membership holds; null if the role has been deleted.',
  })
  roleName?: I18nContent | null;

  @Field(() => MembershipStatus)
  status!: MembershipStatus;

  @Field(() => I18nTextScalar, { nullable: true })
  instituteName?: I18nContent | null;

  @Field(() => DateTimeScalar)
  joinedAt!: Date;
}

@ObjectType({ description: 'A user’s membership in a reseller team' })
export class AdminUserResellerMembershipModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  resellerId!: string;

  @Field()
  resellerName!: string;

  @Field(() => I18nTextScalar, { nullable: true })
  roleName?: I18nContent | null;

  @Field()
  isActive!: boolean;

  @Field(() => DateTimeScalar)
  joinedAt!: Date;
}

@ObjectType({ description: 'A user’s membership in the platform (Roviq staff) team' })
export class AdminUserPlatformMembershipModel {
  @Field(() => ID)
  id!: string;

  @Field(() => I18nTextScalar, { nullable: true })
  roleName?: I18nContent | null;

  @Field()
  isActive!: boolean;

  @Field(() => DateTimeScalar)
  joinedAt!: Date;
}

@ObjectType({ description: 'A government or board identifier held by a user' })
export class AdminUserIdentifierModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserIdentifierType)
  type!: UserIdentifierType;

  @Field(() => String, {
    nullable: true,
    description:
      'Value safe to display. Aadhaar is reduced to its last four digits and PAN to its stored mask; the full value of an encrypted identifier is never returned.',
  })
  displayValue?: string | null;

  @Field()
  isVerified!: boolean;

  @Field(() => String, { nullable: true })
  issuingAuthority?: string | null;
}

@ObjectType({ description: 'A document a user has uploaded' })
export class AdminUserDocumentModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserDocumentType)
  type!: UserDocumentType;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => [String])
  fileUrls!: string[];

  @Field(() => String, { nullable: true })
  referenceNumber?: string | null;

  @Field()
  isVerified!: boolean;

  @Field(() => String, { nullable: true })
  rejectionReason?: string | null;

  @Field(() => DateTimeScalar)
  uploadedAt!: Date;
}

@ObjectType({ description: 'A postal address of a user' })
export class AdminUserAddressModel {
  @Field(() => ID)
  id!: string;

  @Field(() => AddressType)
  type!: AddressType;

  @Field()
  line1!: string;

  @Field(() => String, { nullable: true })
  line2?: string | null;

  @Field(() => String, { nullable: true })
  line3?: string | null;

  @Field()
  city!: string;

  @Field(() => String, { nullable: true })
  district?: string | null;

  @Field()
  state!: string;

  @Field()
  country!: string;

  @Field()
  postalCode!: string;
}

@ObjectType({ isAbstract: true })
abstract class AdminUserBaseModel {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field()
  username!: string;

  @Field(() => UserStatusEnum)
  status!: UserStatusEnum;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar, {
    nullable: true,
    description: 'Most recent sign-in, token refresh or institute switch; null if never seen',
  })
  lastActiveAt?: Date | null;

  @Field(() => AdminUserPhoneModel, { nullable: true })
  primaryPhone?: AdminUserPhoneModel | null;

  @Field(() => [AdminUserMembershipModel], { description: 'Institute memberships only' })
  memberships!: AdminUserMembershipModel[];
}

@ObjectType({ description: 'Admin view of a user with profile and membership details' })
export class AdminUserModel extends AdminUserBaseModel {
  @Field(() => AdminUserProfileModel, { nullable: true })
  profile?: AdminUserProfileModel | null;
}

@ObjectType({ description: 'Everything the admin user detail page shows about one user' })
export class AdminUserDetailModel extends AdminUserBaseModel {
  @Field(() => AdminUserDetailProfileModel, { nullable: true })
  profile?: AdminUserDetailProfileModel | null;

  @Field(() => [AdminUserResellerMembershipModel])
  resellerMemberships!: AdminUserResellerMembershipModel[];

  @Field(() => AdminUserPlatformMembershipModel, { nullable: true })
  platformMembership?: AdminUserPlatformMembershipModel | null;

  @Field(() => [AdminUserIdentifierModel])
  identifiers!: AdminUserIdentifierModel[];

  @Field(() => [AdminUserDocumentModel])
  documents!: AdminUserDocumentModel[];

  @Field(() => [AdminUserAddressModel])
  addresses!: AdminUserAddressModel[];
}

@ObjectType({ description: 'Headline user counts for the admin users page' })
export class AdminUserStatisticsModel {
  @Field(() => Int)
  totalUsers!: number;

  @Field(() => Int, { description: 'Users with a sign-in or token refresh in the last 30 days' })
  activeThisMonth!: number;

  @Field(() => Int, { description: 'Accounts created in the last 7 days' })
  newThisWeek!: number;

  @Field(() => Int, { description: 'Users holding memberships in two or more institutes' })
  multiInstituteUsers!: number;
}

export const { ConnectionType: AdminUserConnection, EdgeType: AdminUserEdge } =
  createConnectionType(AdminUserModel, 'AdminUser');
