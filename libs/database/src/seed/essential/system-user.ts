// libs/database/src/seed/essential/system-user.ts

import { SYSTEM_USER_ID, users } from '../..';
import type { DrizzleDB } from '../../providers';

export async function seedSystemUser(tx: DrizzleDB): Promise<void> {
  await tx
    .insert(users)
    .values({
      id: SYSTEM_USER_ID,
      username: 'system',
      email: 'system@roviq.internal',
      passwordHash: 'disabled-system-user-no-login',
    })
    .onConflictDoNothing({ target: users.id });
  console.log('  System user: system@roviq.internal');
}
