/**
 * ROV-275: IdentityService.discardNewUser removes an account only while nobody has used it.
 */
import { randomUUID } from 'node:crypto';
import {
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  phoneNumbers,
  SYSTEM_USER_ID,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app/app.module';
import { IdentityService } from '../identity.service';

const ORIGIN = 'test:discard-new-user';

describe('IdentityService.discardNewUser (ROV-275)', () => {
  let result: IntegrationAppResult;
  let identity: IdentityService;
  let inst: TestInstitute;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** A new account with a phone and an account profile, as a student create makes it. */
  const newAccount = async (): Promise<string> => {
    const suffix = randomUUID().slice(0, 12);
    const { userId } = await identity.createUser({
      email: `discard-${suffix}@roviq.placeholder`,
      username: `discard-${suffix}`,
      phone: { countryCode: '+91', number: '9123456780' },
      actorId: SYSTEM_USER_ID,
      originTenantId: null,
    });
    await identity.ensureUserProfile(userId, { firstName: 'Tara' }, SYSTEM_USER_ID);
    return userId;
  };

  const rowsOf = (userId: string) =>
    asAdmin(async (tx) => ({
      users: (await tx.select({ id: users.id }).from(users).where(eq(users.id, userId))).length,
      phones: (
        await tx
          .select({ id: phoneNumbers.id })
          .from(phoneNumbers)
          .where(eq(phoneNumbers.userId, userId))
      ).length,
      profiles: (
        await tx
          .select({ id: userProfiles.id })
          .from(userProfiles)
          .where(eq(userProfiles.userId, userId))
      ).length,
    }));

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    identity = result.app.get(IdentityService);
    inst = await createTestInstitute(result.db);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should delete a fresh account with its phone and profile', async () => {
    const userId = await newAccount();
    expect(await rowsOf(userId)).toEqual({ users: 1, phones: 1, profiles: 1 });

    expect(await identity.discardNewUser(userId)).toBe(true);

    expect(await rowsOf(userId)).toEqual({ users: 0, phones: 0, profiles: 0 });
  });

  it('should keep an account that holds a membership, even a deleted one', async () => {
    const userId = await newAccount();
    await asAdmin((tx) =>
      tx.insert(memberships).values({
        userId,
        tenantId: inst.tenantId,
        roleId: inst.roleId,
        status: 'ACTIVE',
        abilities: [],
        deletedAt: new Date(),
        deletedBy: SYSTEM_USER_ID,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      }),
    );

    expect(await identity.discardNewUser(userId)).toBe(false);

    expect(await rowsOf(userId)).toEqual({ users: 1, phones: 1, profiles: 1 });
  });

  it('should keep an account whose password was changed', async () => {
    const userId = await newAccount();
    await asAdmin((tx) =>
      tx.update(users).set({ passwordChangedAt: new Date() }).where(eq(users.id, userId)),
    );

    expect(await identity.discardNewUser(userId)).toBe(false);

    expect(await rowsOf(userId)).toEqual({ users: 1, phones: 1, profiles: 1 });
  });
});
