import type { MembershipWithOrgAndRole, MembershipWithRole } from './types';

export abstract class MembershipRepository {
  abstract findActiveByUserId(userId: string): Promise<MembershipWithOrgAndRole[]>;
  abstract findByUserAndTenant(
    userId: string,
    tenantId: string,
  ): Promise<MembershipWithOrgAndRole | null>;
  abstract findFirstActive(userId: string): Promise<MembershipWithRole | null>;
}
