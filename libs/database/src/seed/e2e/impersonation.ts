import type { DrizzleDB } from '../../providers';
import { impersonationSessions } from '../../schema';
import { SEED_IDS } from '../ids';

const MINUTE = 60_000;

/**
 * Seeds impersonation_sessions so the admin session-detail panel and the reseller
 * impersonation-sessions page (ROV-144) have data to render in E2E. Active sessions
 * use a future expiry relative to seed time (so status resolves ACTIVE during the run);
 * the ended one is fully in the past. Idempotent via onConflictDoNothing on the PK.
 *
 * Impersonators must satisfy the listSessions scoping: USER_RESELLER is a RESELLER_DIRECT
 * team member (reseller page) and USER_ADMIN holds a platform membership.
 */
export async function seedE2eImpersonationSessions(tx: DrizzleDB): Promise<void> {
  const now = Date.now();

  await tx
    .insert(impersonationSessions)
    .values([
      {
        id: SEED_IDS.IMPERSONATION_SESSION_RESELLER_ACTIVE,
        impersonatorId: SEED_IDS.USER_RESELLER,
        impersonatorScope: 'reseller',
        targetUserId: SEED_IDS.USER_TEACHER,
        targetTenantId: SEED_IDS.INSTITUTE_1,
        reason: 'Reseller assisting with attendance setup',
        ipAddress: '203.0.113.10',
        userAgent: 'Mozilla/5.0 (seed)',
        startedAt: new Date(now),
        expiresAt: new Date(now + 55 * MINUTE),
        otpVerified: new Date(now),
        otpVerifiedBy: SEED_IDS.USER_ADMIN,
      },
      {
        id: SEED_IDS.IMPERSONATION_SESSION_RESELLER_ENDED,
        impersonatorId: SEED_IDS.USER_RESELLER,
        impersonatorScope: 'reseller',
        targetUserId: SEED_IDS.USER_TEACHER,
        targetTenantId: SEED_IDS.INSTITUTE_1,
        reason: 'Reseller resolved a billing display issue',
        ipAddress: '203.0.113.11',
        userAgent: 'Mozilla/5.0 (seed)',
        startedAt: new Date(now - 120 * MINUTE),
        expiresAt: new Date(now - 105 * MINUTE),
        endedAt: new Date(now - 110 * MINUTE),
        endedReason: 'manual',
        otpVerified: new Date(now - 120 * MINUTE),
        otpVerifiedBy: SEED_IDS.USER_ADMIN,
      },
      {
        id: SEED_IDS.IMPERSONATION_SESSION_PLATFORM_ACTIVE,
        impersonatorId: SEED_IDS.USER_ADMIN,
        impersonatorScope: 'platform',
        targetUserId: SEED_IDS.USER_TEACHER,
        targetTenantId: SEED_IDS.INSTITUTE_1,
        reason: 'Platform support investigating a report bug',
        ipAddress: '203.0.113.12',
        userAgent: 'Mozilla/5.0 (seed)',
        startedAt: new Date(now),
        expiresAt: new Date(now + 55 * MINUTE),
      },
    ])
    .onConflictDoNothing();
}
