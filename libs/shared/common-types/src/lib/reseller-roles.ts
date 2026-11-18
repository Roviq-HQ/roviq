import type { ResellerTier } from './enums/reseller';

/** System roles every reseller owns a copy of, most senior first. */
export const RESELLER_SYSTEM_ROLE_NAMES = [
  // FULL_MANAGEMENT tier — manages institutes, team and billing
  'reseller_full_admin',
  // SUPPORT_MANAGEMENT tier — read access, impersonation for support, team up to its own level
  'reseller_support_admin',
  // READ_ONLY tier — read access only
  'reseller_viewer',
] as const;

export type ResellerSystemRoleName = (typeof RESELLER_SYSTEM_ROLE_NAMES)[number];

/** The most senior role a reseller of each tier may hold; its first admin gets this one. */
export const RESELLER_TIER_ROLE: Record<ResellerTier, ResellerSystemRoleName> = {
  FULL_MANAGEMENT: 'reseller_full_admin',
  SUPPORT_MANAGEMENT: 'reseller_support_admin',
  READ_ONLY: 'reseller_viewer',
};

const ROLE_RANK: Record<ResellerSystemRoleName, number> = {
  reseller_full_admin: 3,
  reseller_support_admin: 2,
  reseller_viewer: 1,
};

export function isResellerSystemRoleName(name: string): name is ResellerSystemRoleName {
  return (RESELLER_SYSTEM_ROLE_NAMES as readonly string[]).includes(name);
}

/** Seniority of a reseller role; 0 for a role this ladder does not know. */
export function resellerRoleRank(name: string | null | undefined): number {
  return name && isResellerSystemRoleName(name) ? ROLE_RANK[name] : 0;
}

/**
 * Roles the actor may hand out: none above their own role, none above the reseller's tier.
 * A viewer manages nobody.
 */
export function assignableResellerRoleNames(
  actorRoleName: string | null | undefined,
  tier: ResellerTier,
): ResellerSystemRoleName[] {
  const actorRank = resellerRoleRank(actorRoleName);
  if (actorRank < ROLE_RANK.reseller_support_admin) return [];
  const ceiling = Math.min(actorRank, ROLE_RANK[RESELLER_TIER_ROLE[tier]]);
  return RESELLER_SYSTEM_ROLE_NAMES.filter((name) => ROLE_RANK[name] <= ceiling);
}

/** Whether the actor may change a member holding `targetRoleName`: never someone senior to them. */
export function canManageResellerMember(
  actorRoleName: string | null | undefined,
  targetRoleName: string | null | undefined,
): boolean {
  const actorRank = resellerRoleRank(actorRoleName);
  const targetRank = resellerRoleRank(targetRoleName);
  return actorRank >= ROLE_RANK.reseller_support_admin && targetRank > 0 && targetRank <= actorRank;
}

/**
 * Role a member holds after the reseller moves tier. Holders of the old tier's top role
 * follow the tier; anyone left above the new tier is brought down to it; the rest keep theirs.
 */
export function resellerRoleAfterTierChange(
  current: ResellerSystemRoleName,
  oldTier: ResellerTier,
  newTier: ResellerTier,
): ResellerSystemRoleName {
  const newTop = RESELLER_TIER_ROLE[newTier];
  if (current === RESELLER_TIER_ROLE[oldTier]) return newTop;
  return ROLE_RANK[current] > ROLE_RANK[newTop] ? newTop : current;
}
