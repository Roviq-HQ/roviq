import type { AbilitiesRecord } from './types';

export abstract class RoleRepository {
  /** Any role, read as the platform role: sign-in, and reseller and platform callers. */
  abstract findAbilities(roleId: string): Promise<AbilitiesRecord | null>;
  /** A role of `tenantId`, read as the institute role: another institute's role is not found. */
  abstract findInstituteAbilities(
    roleId: string,
    tenantId: string,
  ): Promise<AbilitiesRecord | null>;
  abstract findPrimaryNavSlugs(roleId: string): Promise<string[]>;
}
