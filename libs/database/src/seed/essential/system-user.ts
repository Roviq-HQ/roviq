// libs/database/src/seed/essential/system-user.ts

import { SYSTEM_USER_ID, users } from '../..';
import type { DrizzleDB } from '../../providers';

// Seeded people own their addresses: their email can identify them when a role is granted.
const SEED_EMAIL_VERIFIED_AT = new Date('2026-01-01T00:00:00Z');

export async function seedSystemUser(tx: DrizzleDB): Promise<void> {
  await tx
    .insert(users)
    .values({
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
      id: SYSTEM_USER_ID,
      username: 'system',
      email: 'system@roviq.internal',
      passwordHash: 'disabled-system-user-no-login',
      emailVerifiedAt: SEED_EMAIL_VERIFIED_AT,
    })
    .onConflictDoNothing({ target: users.id });
}
