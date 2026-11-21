import type { MembershipWithInstituteAndRole } from './types';

export abstract class MembershipRepository {
  /** True when the user holds an active membership in an institute that is not ACTIVE. */
  abstract hasMembershipInUnusableInstitute(userId: string): Promise<boolean>;
  abstract findActiveByUserId(userId: string): Promise<MembershipWithInstituteAndRole[]>;
  abstract findManyByUserAndTenant(
    userId: string,
    tenantId: string,
  ): Promise<MembershipWithInstituteAndRole[]>;
  abstract findByIdAndUser(
    membershipId: string,
    userId: string,
  ): Promise<MembershipWithInstituteAndRole | null>;
}
