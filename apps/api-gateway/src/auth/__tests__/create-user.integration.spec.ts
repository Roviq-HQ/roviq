/**
 * ROV-362: IdentityService.createUser writes the account and its primary phone together, so a
 * phone the database refuses leaves no account behind.
 */
import { randomUUID } from 'node:crypto';
import {
  type DrizzleDB,
  mkAdminCtx,
  phoneNumbers,
  SYSTEM_USER_ID,
  users,
  withAdmin,
} from '@roviq/database';
import { createIntegrationApp, type IntegrationAppResult } from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app/app.module';
import { IdentityService } from '../identity.service';

const ORIGIN = 'test:create-user';

describe('IdentityService.createUser (ROV-362)', () => {
  let result: IntegrationAppResult;
  let identity: IdentityService;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const accountsWithEmail = (email: string) =>
    asAdmin((tx) => tx.select({ id: users.id }).from(users).where(eq(users.email, email)));

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    identity = result.app.get(IdentityService);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should write the account and its primary phone', async () => {
    const suffix = randomUUID().slice(0, 12);
    const email = `create-${suffix}@roviq.placeholder`;

    const { userId } = await identity.createUser({
      email,
      username: `create-${suffix}`,
      phone: { countryCode: '+91', number: '9123456781' },
      actorId: SYSTEM_USER_ID,
    });

    const phones = await asAdmin((tx) =>
      tx
        .select({ number: phoneNumbers.number, isPrimary: phoneNumbers.isPrimary })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.userId, userId)),
    );
    expect(phones).toEqual([{ number: '9123456781', isPrimary: true }]);
    expect(await accountsWithEmail(email)).toEqual([{ id: userId }]);
  });

  it('should leave no account when the phone cannot be stored', async () => {
    const suffix = randomUUID().slice(0, 12);
    const email = `create-${suffix}@roviq.placeholder`;

    // PostgreSQL refuses a NUL byte in text, so the phone insert fails after the user insert.
    await expect(
      identity.createUser({
        email,
        username: `create-${suffix}`,
        phone: { countryCode: '+91', number: '91234\u000056782' },
        actorId: SYSTEM_USER_ID,
      }),
    ).rejects.toThrow();

    expect(await accountsWithEmail(email)).toEqual([]);
  });
});
