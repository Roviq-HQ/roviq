import type { AbilitiesRecord } from './types';

export abstract class MembershipAbilityRepository {
  abstract findAbilities(membershipId: string, tenantId: string): Promise<AbilitiesRecord | null>;
  abstract findReadAssignments(
    membershipId: string,
    tenantId: string,
  ): Promise<{ assignedSections: string[]; linkedStudentIds: string[] }>;
}
