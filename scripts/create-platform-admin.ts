/**
 * Creates the first platform admin on a database that holds only the essential seed (a staging or
 * production database). The password is random, printed once, and must be changed at first sign-in.
 * Does nothing when a platform admin already exists, so a deploy can run it every time.
 *
 * Usage: pnpm exec tsx scripts/create-platform-admin.ts --username <roviq id> --email <address>
 *        [--first-name <name>]
 * Needs DATABASE_URL_MIGRATE (the owner role): it writes before any request context exists.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { hash } from '@node-rs/argon2';
import { eq, isNull } from 'drizzle-orm';
import { Pool } from 'pg';
import {
  platformMemberships,
  roles,
  SYSTEM_USER_ID,
  userProfiles,
  users,
} from '../libs/database/src';
import { createDrizzleDb } from '../libs/database/src/providers';
import { SEED_IDS } from '../libs/database/src/seed';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    email: { type: 'string' },
    'first-name': { type: 'string', default: 'Platform admin' },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const username = values.username ?? fail('--username is required');
const email = values.email ?? fail('--email is required');
const connectionString =
  process.env.DATABASE_URL_MIGRATE ?? fail('DATABASE_URL_MIGRATE is not set');

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

async function main(): Promise<void> {
  const pool = new Pool({ connectionString });
  const db = createDrizzleDb(pool);
  try {
    const password = randomBytes(18).toString('base64url');
    const created = await db.transaction(async (tx) => {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.id, SEED_IDS.ROLE_PLATFORM_ADMIN))
        .limit(1);
      if (!role) fail('The platform_admin role is missing: run the essential seed first.');

      const [existing] = await tx
        .select({ id: platformMemberships.id })
        .from(platformMemberships) // allow-base-read: bootstrap check before any context exists
        .where(isNull(platformMemberships.deletedAt))
        .limit(1);
      if (existing) return false;

      const [user] = await tx
        .insert(users)
        .values({
          username,
          email,
          passwordHash: await hash(password),
          mustChangePassword: true,
          ...BY,
        })
        .returning({ id: users.id });
      await tx.insert(userProfiles).values({
        userId: user.id,
        firstName: { en: values['first-name'] ?? 'Platform admin' },
        ...BY,
      });
      await tx.insert(platformMemberships).values({ userId: user.id, roleId: role.id, ...BY });
      return true;
    });

    if (!created) {
      console.info('A platform admin already exists; nothing created.');
      return;
    }
    console.info(`Created platform admin "${username}". Temporary password (shown once):`);
    console.info(password);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('create-platform-admin failed:', err);
  process.exit(1);
});
