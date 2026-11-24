import {
  type AbilityRule,
  RESELLER_SYSTEM_ROLE_NAMES,
  type ResellerSystemRoleName,
} from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './providers';
import { roles } from './schema/tenant/roles';

export { RESELLER_SYSTEM_ROLE_NAMES, type ResellerSystemRoleName };

// An explicit list, never `read all`: that would include payment gateway configurations,
// which hold API keys.
const VIEWER_ABILITIES: AbilityRule[] = [
  { action: 'read', subject: 'Institute' },
  { action: 'view_statistics', subject: 'Institute' },
  { action: 'read', subject: 'InstituteGroup' },
  { action: 'read', subject: 'BillingDashboard' },
  { action: 'read', subject: 'Subscription' },
  { action: 'read', subject: 'Invoice' },
];

export const RESELLER_SYSTEM_ROLE_ABILITIES: Record<ResellerSystemRoleName, AbilityRule[]> = {
  reseller_full_admin: [
    { action: 'create', subject: 'Institute' },
    { action: 'read', subject: 'Institute' },
    { action: 'update', subject: 'Institute' },
    { action: 'approve', subject: 'Institute' },
    { action: 'activate', subject: 'Institute' },
    { action: 'deactivate', subject: 'Institute' },
    { action: 'suspend', subject: 'Institute' },
    { action: 'reject', subject: 'Institute' },
    { action: 'view_statistics', subject: 'Institute' },
    // Picking whom to impersonate needs the institute's member list (ROV-101).
    { action: 'read', subject: 'User' },
    { action: 'impersonate', subject: 'User' },
    { action: 'manage', subject: 'InstituteGroup' },
    { action: 'read', subject: 'AcademicYear' },
    { action: 'read', subject: 'Standard' },
    { action: 'read', subject: 'Section' },
    { action: 'read', subject: 'Subject' },
    { action: 'manage', subject: 'SubscriptionPlan' },
    { action: 'manage', subject: 'Subscription' },
    { action: 'manage', subject: 'Invoice' },
    { action: 'manage', subject: 'Payment' },
    { action: 'manage', subject: 'PaymentGatewayConfig' },
    { action: 'read', subject: 'BillingDashboard' },
    { action: 'read', subject: 'AuditLog' },
    { action: 'manage', subject: 'ResellerTeam' },
    // Its own reseller record only: RLS and column grants bound what "update" reaches.
    { action: 'read', subject: 'Reseller' },
    { action: 'update', subject: 'Reseller' },
  ],
  // Impersonation by support staff is view-only (ImpersonationService, SF-016).
  reseller_support_admin: [
    ...VIEWER_ABILITIES,
    { action: 'read', subject: 'User' },
    { action: 'impersonate', subject: 'User' },
    // Capped in ResellerTeamService: never a member or a role senior to their own.
    { action: 'manage', subject: 'ResellerTeam' },
  ],
  reseller_viewer: VIEWER_ABILITIES,
};

/**
 * Gives a reseller its own copy of the three reseller system roles and returns
 * their ids by name. Idempotent: an existing copy has its abilities refreshed.
 */
export async function provisionResellerSystemRoles(
  tx: DrizzleDB,
  resellerId: string,
  actorId: string,
): Promise<Record<ResellerSystemRoleName, string>> {
  const rows = await tx
    .insert(roles)
    .values(
      RESELLER_SYSTEM_ROLE_NAMES.map((name) => ({
        scope: 'reseller',
        resellerId,
        name: { en: name },
        abilities: RESELLER_SYSTEM_ROLE_ABILITIES[name],
        isSystem: true,
        isDefault: false,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    )
    .onConflictDoUpdate({
      target: [roles.resellerId, roles.name],
      targetWhere: sql`${roles.scope} = 'reseller' AND ${roles.deletedAt} IS NULL`,
      set: { abilities: sql`excluded.abilities`, updatedAt: new Date(), updatedBy: actorId },
    })
    .returning({ id: roles.id, name: roles.name });

  const idByName = new Map(rows.map((row) => [row.name.en, row.id]));
  const requireId = (name: ResellerSystemRoleName): string => {
    const id = idByName.get(name);
    if (!id) throw new Error(`Reseller system role ${name} was not provisioned for ${resellerId}`);
    return id;
  };
  return {
    reseller_full_admin: requireId('reseller_full_admin'),
    reseller_support_admin: requireId('reseller_support_admin'),
    reseller_viewer: requireId('reseller_viewer'),
  };
}
