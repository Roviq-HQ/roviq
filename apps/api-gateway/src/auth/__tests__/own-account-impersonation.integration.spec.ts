/**
 * Own-account operations belong to the person. During an impersonation session, of any write
 * mode, each is refused with IMPERSONATION_OWN_ACCOUNT and nothing of the account changes;
 * the few reads the app shell needs still answer. The same calls work with the person's token.
 */
import assert from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import {
  authProviders,
  type DrizzleDB,
  impersonationSessions,
  mkAdminCtx,
  phoneNumbers,
  refreshTokens,
  userProfiles,
  users,
  usersLive,
  withAdmin,
  withUser,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  createImpersonationToken,
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  signedInAs,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../app/app.module';

const REFUSED = 'IMPERSONATION_OWN_ACCOUNT';
const READ_ONLY_TRANSACTION = '25006';
const PASSWORD = 'Own-Account-9!pass';
const NEW_PASSWORD = 'Other-Account-7!word';

const MY_SESSIONS = 'query($t: String!) { mySessions(currentRefreshToken: $t) { id ipAddress } }';
const REVOKE_SESSION = 'mutation($id: String!) { revokeSession(sessionId: $id) }';
const REVOKE_OTHERS = 'mutation($t: String!) { revokeAllOtherSessions(currentRefreshToken: $t) }';
const LOGOUT = 'mutation($t: String!) { logout(currentRefreshToken: $t) }';
const CHANGE_PASSWORD =
  'mutation($c: String!, $n: String!) { changePassword(currentPassword: $c, newPassword: $n) }';
const MY_PASSKEYS = 'query { myPasskeys { id name } }';
const REMOVE_PASSKEY = 'mutation($id: String!) { removePasskey(passkeyId: $id) }';
const PASSKEY_OPTIONS =
  'mutation($p: String!) { generatePasskeyRegistrationOptions(input: { password: $p }) }';
const PASSKEY_VERIFY =
  'mutation($c: JSON!) { verifyPasskeyRegistration(input: { credential: $c }) { id } }';
const UPDATE_PROFILE =
  'mutation($n: String!) { updateMyProfile(input: { nationality: $n }) { nationality } }';
const UPDATE_PHONE =
  'mutation($p: String!) { updateMyProfile(input: { phone: $p }) { nationality } }';
const UPDATE_LOCALE = 'mutation { updateMyPreferredLocale(input: { locale: "hi" }) }';
const UPDATE_HELP_MODE = 'mutation { updateMyFormHelpMode(mode: ICON_ONLY) }';
const EMAIL_STATE = 'query { myEmailVerification { email isVerified } }';
const EMAIL_REQUEST = 'mutation { requestEmailVerification }';
const EMAIL_VERIFY = 'mutation { verifyEmail(code: "123456") }';
const ME = 'query { me { id username email } }';
const MY_LOCALE = 'query { myPreferredLocale }';
const MY_HELP_MODE = 'query { myFormHelpMode }';
const MY_PROFILE = 'query { myProfile { ... on MyStaffProfile { type } } }';

describe('Own-account operations during impersonation (integration)', () => {
  let result: IntegrationAppResult;
  let inst: TestInstitute;
  let ownToken: string;
  let impersonationToken: string;
  let impersonationSessionId = '';
  let sessionOne = '';
  let sessionTwo = '';
  let passkeyId = '';
  const rawRefreshToken = randomBytes(24).toString('hex');

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[2]) =>
    withAdmin(result.db, mkAdminCtx('test:own-account-impersonation'), fn);

  const call = (query: string, token: string, variables?: Record<string, unknown>) =>
    gqlRequest<Record<string, unknown>>(result.httpServer, { query, variables, token });

  const codeOf = async (query: string, variables?: Record<string, unknown>) => {
    const res = await call(query, impersonationToken, variables);
    return res.errors?.[0]?.extensions?.code;
  };

  /** Everything of the account an own-account operation could change. */
  const accountState = () =>
    admin(async (tx) => {
      const [account] = await tx
        .select({
          passwordHash: users.passwordHash,
          tokenVersion: users.tokenVersion,
          preferredLocale: users.preferredLocale,
          formHelpMode: users.formHelpMode,
          emailVerifiedAt: users.emailVerifiedAt,
        })
        .from(users) // allow-base-read: password_hash and token_version are not on users_live
        .where(eq(users.id, inst.userId));
      const sessions = await tx
        .select({ id: refreshTokens.id, revokedAt: refreshTokens.revokedAt })
        .from(refreshTokens) // allow-base-read: revoked rows are what this compares
        .where(eq(refreshTokens.userId, inst.userId))
        .orderBy(refreshTokens.id);
      const passkeys = await tx
        .select({ id: authProviders.id, deletedAt: authProviders.deletedAt })
        .from(authProviders) // allow-base-read: a removed passkey is what this compares
        .where(eq(authProviders.userId, inst.userId))
        .orderBy(authProviders.id);
      const profile = await tx
        .select({ nationality: userProfiles.nationality })
        .from(userProfiles) // allow-base-read: test fixture state
        .where(eq(userProfiles.userId, inst.userId));
      const phones = await tx
        .select({ number: phoneNumbers.number })
        .from(phoneNumbers) // allow-base-read: test fixture state
        .where(eq(phoneNumbers.userId, inst.userId));
      return { account, sessions, passkeys, profile, phones };
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    inst = await createTestInstitute(result.db, { password: PASSWORD });
    ownToken = createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });

    await admin(async (tx) => {
      const session = {
        createdBy: inst.userId,
        updatedBy: inst.userId,
        tenantId: inst.tenantId,
        userId: inst.userId,
        membershipId: inst.membershipId,
        membershipScope: 'institute',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ipAddress: '203.0.113.7',
      };
      const created = await tx
        .insert(refreshTokens)
        .values([
          {
            ...session,
            tokenHash: createHash('sha256').update(rawRefreshToken).digest('hex'),
          },
          { ...session, tokenHash: createHash('sha256').update(randomBytes(24)).digest('hex') },
        ])
        .returning({ id: refreshTokens.id });
      sessionOne = created[0].id;
      sessionTwo = created[1].id;

      const [passkey] = await tx
        .insert(authProviders)
        .values({
          createdBy: inst.userId,
          updatedBy: inst.userId,
          userId: inst.userId,
          provider: 'passkey',
          providerUserId: randomBytes(16).toString('base64url'),
          providerData: {
            name: 'Laptop',
            publicKey: 'AA',
            counter: 0,
            deviceType: 'singleDevice',
            backedUp: false,
            transports: [],
            registeredAt: new Date().toISOString(),
          },
        })
        .returning({ id: authProviders.id });
      passkeyId = passkey.id;

      await tx
        .insert(userProfiles)
        .values({
          createdBy: inst.userId,
          updatedBy: inst.userId,
          userId: inst.userId,
          firstName: { en: 'Own' },
          nationality: 'Indian',
        })
        .onConflictDoNothing();

      const [session2] = await tx
        .insert(impersonationSessions)
        .values({
          impersonatorId: SEED_IDS.USER_ADMIN,
          impersonatorScope: 'platform',
          targetUserId: inst.userId,
          targetTenantId: inst.tenantId,
          reason: 'integration test — own-account operations',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        })
        .returning({ id: impersonationSessions.id });
      assert(session2);
      impersonationSessionId = session2.id;
    });

    impersonationToken = createImpersonationToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
      impersonatorId: SEED_IDS.USER_ADMIN,
      impersonationSessionId,
    });
  });

  afterAll(async () => {
    if (result && inst) {
      await admin(async (tx) => {
        if (impersonationSessionId) {
          await tx
            .delete(impersonationSessions)
            .where(eq(impersonationSessions.id, impersonationSessionId));
        }
        await tx.delete(refreshTokens).where(eq(refreshTokens.userId, inst.userId));
        await tx.delete(authProviders).where(eq(authProviders.userId, inst.userId));
        await tx.delete(phoneNumbers).where(eq(phoneNumbers.userId, inst.userId));
        await tx.delete(userProfiles).where(eq(userProfiles.userId, inst.userId));
      });
      await cleanupTestInstitute(result.db, inst);
    }
    await result?.close();
  });

  describe('with a write-capable impersonation token', () => {
    it.each([
      ['mySessions', MY_SESSIONS, () => ({ t: rawRefreshToken })],
      ['revokeSession', REVOKE_SESSION, () => ({ id: sessionTwo })],
      ['revokeAllOtherSessions', REVOKE_OTHERS, () => ({ t: rawRefreshToken })],
      ['logout', LOGOUT, () => ({ t: rawRefreshToken })],
      [
        'changePassword, right current password',
        CHANGE_PASSWORD,
        () => ({ c: PASSWORD, n: NEW_PASSWORD }),
      ],
      [
        'changePassword, wrong current password',
        CHANGE_PASSWORD,
        () => ({ c: 'Wrong-1!guess', n: NEW_PASSWORD }),
      ],
      ['myPasskeys', MY_PASSKEYS, () => undefined],
      ['removePasskey', REMOVE_PASSKEY, () => ({ id: passkeyId })],
      [
        'generatePasskeyRegistrationOptions, right password',
        PASSKEY_OPTIONS,
        () => ({ p: PASSWORD }),
      ],
      [
        'generatePasskeyRegistrationOptions, wrong password',
        PASSKEY_OPTIONS,
        () => ({ p: 'Wrong-1!guess' }),
      ],
      ['verifyPasskeyRegistration', PASSKEY_VERIFY, () => ({ c: { id: 'x' } })],
      ['updateMyProfile', UPDATE_PROFILE, () => ({ n: 'Changed' })],
      ['updateMyProfile, phone', UPDATE_PHONE, () => ({ p: '9812345678' })],
      ['updateMyPreferredLocale', UPDATE_LOCALE, () => undefined],
      ['updateMyFormHelpMode', UPDATE_HELP_MODE, () => undefined],
      ['myEmailVerification', EMAIL_STATE, () => undefined],
      ['requestEmailVerification', EMAIL_REQUEST, () => undefined],
      ['verifyEmail', EMAIL_VERIFY, () => undefined],
    ])('should refuse %s and change nothing', async (_name, query, variables) => {
      const before = await accountState();
      expect(await codeOf(query, variables())).toBe(REFUSED);
      expect(await accountState()).toEqual(before);
    });

    it.each([
      ['me', ME],
      ['myPreferredLocale', MY_LOCALE],
      ['myFormHelpMode', MY_HELP_MODE],
      ['myProfile', MY_PROFILE],
    ])('should still answer %s, which the app shell reads', async (_name, query) => {
      const res = await call(query, impersonationToken);
      expect(res.errors).toBeUndefined();
    });

    it('should answer me with the name of the account, not its secrets', async () => {
      const res = await call(ME, impersonationToken);
      expect(res.data?.me).toMatchObject({ id: inst.userId, username: inst.username });
    });
  });

  describe('withUser, for a new own-account call site', () => {
    const impersonated = () => ({ ...signedInAs(inst.userId), isImpersonated: true });
    const setLocale = (tx: DrizzleDB) =>
      tx.update(users).set({ preferredLocale: 'hi' }).where(eq(users.id, inst.userId));

    it('should refuse an impersonation session before any statement runs', async () => {
      const before = await accountState();
      let ran = false;
      await expect(
        withUser(result.db, impersonated(), 'PERSON_ONLY', async (tx) => {
          ran = true;
          await setLocale(tx);
        }),
      ).rejects.toMatchObject({ code: REFUSED });
      expect(ran).toBe(false);
      expect(await accountState()).toEqual(before);
    });

    it('should let PostgreSQL refuse a write in a call that lets an impersonator read', async () => {
      const before = await accountState();
      await expect(
        withUser(result.db, impersonated(), 'IMPERSONATOR_MAY_READ', setLocale),
      ).rejects.toMatchObject({ cause: { code: READ_ONLY_TRANSACTION } });
      expect(await accountState()).toEqual(before);
    });

    it('should let that call read the own row, and write for the person', async () => {
      const read = await withUser(result.db, impersonated(), 'IMPERSONATOR_MAY_READ', (tx) =>
        tx.select({ id: usersLive.id }).from(usersLive),
      );
      expect(read).toEqual([{ id: inst.userId }]);
      await withUser(result.db, signedInAs(inst.userId), 'IMPERSONATOR_MAY_READ', setLocale);
      expect((await accountState()).account?.preferredLocale).toBe('hi');
      await admin((tx) =>
        tx.update(users).set({ preferredLocale: null }).where(eq(users.id, inst.userId)),
      );
    });
  });

  // Last: these change the account.
  describe("with the person's own token", () => {
    it('should list sessions and passkeys', async () => {
      const sessions = await call(MY_SESSIONS, ownToken, { t: rawRefreshToken });
      expect(sessions.errors).toBeUndefined();
      expect(sessions.data?.mySessions).toHaveLength(2);
      const passkeys = await call(MY_PASSKEYS, ownToken);
      expect(passkeys.data?.myPasskeys).toEqual([{ id: passkeyId, name: 'Laptop' }]);
    });

    it('should save the profile, the language and the help mode', async () => {
      expect((await call(UPDATE_PROFILE, ownToken, { n: 'Changed' })).errors).toBeUndefined();
      expect((await call(UPDATE_LOCALE, ownToken)).errors).toBeUndefined();
      expect((await call(UPDATE_HELP_MODE, ownToken)).errors).toBeUndefined();
      const state = await accountState();
      expect(state.profile).toEqual([{ nationality: 'Changed' }]);
      expect(state.account).toMatchObject({ preferredLocale: 'hi', formHelpMode: 'ICON_ONLY' });
    });

    it('should read the email state', async () => {
      const res = await call(EMAIL_STATE, ownToken);
      expect(res.errors).toBeUndefined();
    });

    it('should revoke a session and remove a passkey', async () => {
      expect((await call(REVOKE_SESSION, ownToken, { id: sessionTwo })).errors).toBeUndefined();
      expect((await call(REMOVE_PASSKEY, ownToken, { id: passkeyId })).errors).toBeUndefined();
      const state = await accountState();
      expect(state.sessions.find((s) => s.id === sessionTwo)?.revokedAt).not.toBeNull();
      expect(state.sessions.find((s) => s.id === sessionOne)?.revokedAt).toBeNull();
      expect(state.passkeys[0]?.deletedAt).not.toBeNull();
    });

    it('should change the password', async () => {
      const res = await call(CHANGE_PASSWORD, ownToken, { c: PASSWORD, n: NEW_PASSWORD });
      expect(res.errors).toBeUndefined();
    });
  });
});
