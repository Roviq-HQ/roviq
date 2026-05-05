import { sql } from 'drizzle-orm';
import { roles, SYSTEM_USER_ID } from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

export async function seedSystemRoles(tx: DrizzleDB): Promise<void> {
  const systemRoles = [
    {
      id: SEED_IDS.ROLE_PLATFORM_ADMIN,
      scope: 'platform',
      name: 'platform_admin',
      abilities: [{ action: 'manage', subject: 'all' }],
    },
    {
      id: SEED_IDS.ROLE_PLATFORM_SUPPORT,
      scope: 'platform',
      name: 'platform_support',
      abilities: [
        { action: 'read', subject: 'all' },
        { action: 'impersonate', subject: 'User' },
      ],
    },
    {
      id: SEED_IDS.ROLE_RESELLER_FULL_ADMIN,
      scope: 'reseller',
      name: 'reseller_full_admin',
      resellerId: SEED_IDS.RESELLER_DIRECT,
      abilities: [
        { action: 'create', subject: 'Institute' },
        { action: 'read', subject: 'Institute' },
        { action: 'update', subject: 'Institute' },
        { action: 'approve', subject: 'Institute' },
        { action: 'activate', subject: 'Institute' },
        { action: 'deactivate', subject: 'Institute' },
        { action: 'suspend', subject: 'Institute' },
        { action: 'reject', subject: 'Institute' },
        { action: 'view_statistics', subject: 'Institute' },
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
      ],
    },
    {
      id: SEED_IDS.ROLE_RESELLER_SUPPORT_ADMIN,
      scope: 'reseller',
      name: 'reseller_support_admin',
      resellerId: SEED_IDS.RESELLER_DIRECT,
      abilities: [
        { action: 'read', subject: 'all' },
        { action: 'impersonate', subject: 'User' },
      ],
    },
    {
      id: SEED_IDS.ROLE_RESELLER_VIEWER,
      scope: 'reseller',
      name: 'reseller_viewer',
      resellerId: SEED_IDS.RESELLER_DIRECT,
      abilities: [{ action: 'read', subject: 'all' }],
    },
  ] as const;

  await tx
    .insert(roles)
    .values(
      systemRoles.map((sr) => ({
        id: sr.id,
        scope: sr.scope,
        resellerId: 'resellerId' in sr ? sr.resellerId : null,
        name: { en: sr.name },
        abilities: JSON.parse(JSON.stringify(sr.abilities)),
        isSystem: true,
        isDefault: false,
        ...BY,
      })),
    )
    .onConflictDoUpdate({
      target: roles.id,
      set: {
        updatedAt: new Date(),
        abilities: sql`excluded.abilities`,
        name: sql`excluded.name`,
        resellerId: sql`excluded.reseller_id`,
        scope: sql`excluded.scope`,
      },
    });
}
