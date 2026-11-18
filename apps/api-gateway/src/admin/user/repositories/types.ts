import type {
  AddressType,
  Gender,
  MembershipStatus,
  UserDocumentType,
  UserIdentifierType,
} from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';

export type AdminUserStatus = 'ACTIVE' | 'SUSPENDED' | 'LOCKED';

export interface AdminUserListQuery {
  search?: string;
  status?: AdminUserStatus[];
  tenantId?: string;
  hasInstituteMembership?: boolean;
  hasPlatformMembership?: boolean;
  hasResellerMembership?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
  first: number;
  after?: string;
}

export interface AdminUserProfileRecord {
  firstName: I18nContent;
  lastName: I18nContent | null;
  profileImageUrl: string | null;
}

export interface AdminUserPhoneRecord {
  countryCode: string;
  number: string;
}

export interface AdminUserMembershipRecord {
  id: string;
  tenantId: string;
  roleId: string;
  roleName: I18nContent | null;
  status: MembershipStatus;
  instituteName: I18nContent | null;
  joinedAt: Date;
}

export interface AdminUserRecord {
  id: string;
  email: string;
  username: string;
  status: AdminUserStatus;
  createdAt: Date;
  lastActiveAt: Date | null;
  primaryPhone: AdminUserPhoneRecord | null;
  profile: AdminUserProfileRecord | null;
  memberships: AdminUserMembershipRecord[];
}

export interface AdminUserListResult {
  edges: Array<{ node: AdminUserRecord; cursor: string }>;
  hasNextPage: boolean;
  totalCount: number;
}

export interface AdminUserDetailProfileRecord extends AdminUserProfileRecord {
  gender: Gender | null;
  dateOfBirth: string | null;
  nationality: string | null;
}

export interface AdminUserResellerMembershipRecord {
  id: string;
  resellerId: string;
  resellerName: string;
  roleName: I18nContent | null;
  isActive: boolean;
  joinedAt: Date;
}

export interface AdminUserPlatformMembershipRecord {
  id: string;
  roleName: I18nContent | null;
  isActive: boolean;
  joinedAt: Date;
}

export interface AdminUserIdentifierRecord {
  id: string;
  type: UserIdentifierType;
  /** Never the raw value of an encrypted identifier — see the repository. */
  displayValue: string | null;
  isVerified: boolean;
  issuingAuthority: string | null;
}

export interface AdminUserDocumentRecord {
  id: string;
  type: UserDocumentType;
  description: string | null;
  fileUrls: string[];
  referenceNumber: string | null;
  isVerified: boolean;
  rejectionReason: string | null;
  uploadedAt: Date;
}

export interface AdminUserAddressRecord {
  id: string;
  type: AddressType;
  line1: string;
  line2: string | null;
  line3: string | null;
  city: string;
  district: string | null;
  state: string;
  country: string;
  postalCode: string;
}

export interface AdminUserDetailRecord extends Omit<AdminUserRecord, 'profile'> {
  profile: AdminUserDetailProfileRecord | null;
  resellerMemberships: AdminUserResellerMembershipRecord[];
  platformMembership: AdminUserPlatformMembershipRecord | null;
  identifiers: AdminUserIdentifierRecord[];
  documents: AdminUserDocumentRecord[];
  addresses: AdminUserAddressRecord[];
}

export interface AdminUserStatisticsRecord {
  totalUsers: number;
  activeThisMonth: number;
  newThisWeek: number;
  multiInstituteUsers: number;
}
