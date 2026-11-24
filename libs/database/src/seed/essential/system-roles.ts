import type { AbilityRule } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import { resellersLive, roles, SYSTEM_USER_ID } from '../..';
import type { DrizzleDB } from '../../providers';
import {
  provisionResellerSystemRoles,
  RESELLER_SYSTEM_ROLE_ABILITIES,
} from '../../reseller-system-roles';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

interface SystemRoleSeed {
  id: string;
  scope: 'platform' | 'reseller';
  name: string;
  resellerId: string | null;
  abilities: AbilityRule[];
}

export async function seedSystemRoles(tx: DrizzleDB): Promise<void> {
  const systemRoles: SystemRoleSeed[] = [
    {
      id: SEED_IDS.ROLE_PLATFORM_ADMIN,
      scope: 'platform',
      name: 'platform_admin',
      resellerId: null,
      abilities: [{ action: 'manage', subject: 'all' }],
    },
    {
      id: SEED_IDS.ROLE_PLATFORM_SUPPORT,
      scope: 'platform',
      name: 'platform_support',
      resellerId: null,
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
      abilities: RESELLER_SYSTEM_ROLE_ABILITIES.reseller_full_admin,
    },
    {
      id: SEED_IDS.ROLE_RESELLER_SUPPORT_ADMIN,
      scope: 'reseller',
      name: 'reseller_support_admin',
      resellerId: SEED_IDS.RESELLER_DIRECT,
      abilities: RESELLER_SYSTEM_ROLE_ABILITIES.reseller_support_admin,
    },
    {
      id: SEED_IDS.ROLE_RESELLER_VIEWER,
      scope: 'reseller',
      name: 'reseller_viewer',
      resellerId: SEED_IDS.RESELLER_DIRECT,
      abilities: RESELLER_SYSTEM_ROLE_ABILITIES.reseller_viewer,
    },
  ];

  await tx
    .insert(roles)
    .values(
      systemRoles.map((sr) => ({
        id: sr.id,
        scope: sr.scope,
        resellerId: sr.resellerId,
        name: { en: sr.name },
        abilities: sr.abilities,
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

  // Every reseller owns a copy of the system roles; a changed ability list reaches them all.
  const live = await tx.select({ id: resellersLive.id }).from(resellersLive);
  for (const reseller of live) {
    await provisionResellerSystemRoles(tx, reseller.id, SYSTEM_USER_ID);
  }
}
