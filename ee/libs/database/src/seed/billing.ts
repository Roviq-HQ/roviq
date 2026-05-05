// ee/libs/database/src/seed/billing.ts

import type { DrizzleDB } from '@roviq/database';
import { SYSTEM_USER_ID } from '@roviq/database';
import { SEED_IDS } from '@roviq/database/seed';
import { plans } from '@roviq/ee-database';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

export async function seedBillingData(tx: DrizzleDB) {
  await tx
    .insert(plans)
    .values({
      id: SEED_IDS.PLAN_FREE,
      resellerId: SEED_IDS.RESELLER_DIRECT,
      name: { en: 'Free' },
      description: { en: 'Free tier for evaluation' },
      code: 'FREE',
      interval: 'MONTHLY',
      amount: 0n,
      currency: 'INR',
      entitlements: {
        maxStudents: 10,
        maxStaff: 5,
        maxStorageMb: 512,
        auditLogRetentionDays: 90,
        features: [],
      },
      ...BY,
    })
    .onConflictDoUpdate({ target: plans.id, set: { updatedAt: new Date() } });

  await tx
    .insert(plans)
    .values({
      id: SEED_IDS.PLAN_PRO,
      resellerId: SEED_IDS.RESELLER_DIRECT,
      name: { en: 'Pro' },
      description: { en: 'Professional plan for growing institutes' },
      code: 'PRO',
      interval: 'MONTHLY',
      amount: 99900n,
      currency: 'INR',
      entitlements: {
        maxStudents: 500,
        maxStaff: 50,
        maxStorageMb: 5120,
        auditLogRetentionDays: 365,
        features: ['advanced_timetable', 'bulk_sms'],
      },
      ...BY,
    })
    .onConflictDoUpdate({ target: plans.id, set: { updatedAt: new Date() } });
}
