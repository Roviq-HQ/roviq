/**
 * `InstituteModel.firstAdmin` carries a person's email and phone, read from the user named in
 * `first_admin_user_id`: only the platform and the reseller that owns the institute may read
 * it. Institute-scope callers (the institute admin, a teacher) get FORBIDDEN on the field even
 * from their own `myInstitute`. The user is resolved when the institute is requested; a
 * reseller sees the name and phone only of an account its own staff created.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  institutes,
  memberships,
  mkAdminCtx,
  phoneNumbers,
  SYSTEM_USER_ID,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
  type TestTeacher,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';
import { IdentityService } from '../../../auth/identity.service';

function uniqueMobile(): string {
  return `98${String(Number.parseInt(randomUUID().slice(0, 8), 16) % 100_000_000).padStart(8, '0')}`;
}

/** An existing account no reseller created: its name and phone must not reach a reseller. */
const FIRST_ADMIN = {
  firstName: 'Kavitha',
  lastName: 'Raghunathan',
  email: `kavitha.first-admin-${randomUUID().slice(0, 8)}@institute.test`,
  phone: uniqueMobile(),
};
const WITHHELD = {
  firstName: null,
  lastName: null,
  email: FIRST_ADMIN.email,
  phone: null,
  detailsWithheld: true,
};

const FIELDS = 'firstAdmin { firstName lastName email phone detailsWithheld }';
const MY_INSTITUTE = `query { myInstitute { id firstAdmin { email phone } } }`;
const ADMIN_GET = `query ($id: ID!) { adminGetInstitute(id: $id) { id ${FIELDS} } }`;
const CREATE_REQUEST = `mutation ($input: ResellerCreateInstituteRequestInput!) {
  resellerCreateInstituteRequest(input: $input) { id }
}`;
const RESELLER_GET = `query ($id: ID!) { resellerGetInstitute(id: $id) { id ${FIELDS} } }`;

interface FirstAdminData {
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  detailsWithheld: boolean;
}

function expectNoPersonalDetails(response: unknown) {
  const serialized = JSON.stringify(response);
  for (const hidden of [FIRST_ADMIN.firstName, FIRST_ADMIN.lastName, FIRST_ADMIN.phone]) {
    expect(serialized).not.toContain(hidden);
  }
}

describe('InstituteModel.firstAdmin visibility (integration)', () => {
  let result: IntegrationAppResult;
  let owner: TestReseller;
  let otherReseller: TestReseller;
  let institute: TestInstitute;
  let teacher: TestTeacher;
  let identity: IdentityService;
  const createdInstituteIds: string[] = [];

  const platformToken = () =>
    createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });

  const resellerToken = (r: TestReseller) =>
    createResellerToken({
      sub: r.userId,
      resellerId: r.resellerId,
      membershipId: r.membershipId,
      roleId: r.roleId,
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    owner = await createTestReseller(result.db);
    otherReseller = await createTestReseller(result.db);
    institute = await createTestInstitute(result.db, { resellerId: owner.resellerId });
    teacher = await createTestTeacher(result.db, institute.tenantId);
    identity = result.app.get(IdentityService);
    const { userId } = await identity.createUser({
      email: FIRST_ADMIN.email,
      username: FIRST_ADMIN.email,
      phone: { countryCode: '+91', number: FIRST_ADMIN.phone },
      actorId: SYSTEM_USER_ID,
    });
    await identity.ensureUserProfile(userId, FIRST_ADMIN, SYSTEM_USER_ID);
    await withAdmin(result.db, mkAdminCtx('test:first-admin'), async (tx) => {
      // The owner of this account has proved the mailbox, so its email may identify it.
      await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
      await tx
        .update(institutes)
        .set({ firstAdminUserId: userId })
        .where(eq(institutes.id, institute.tenantId));
    });
  });

  afterAll(async () => {
    if (createdInstituteIds.length > 0) {
      await withAdmin(result.db, mkAdminCtx('test:first-admin'), async (tx) => {
        await tx.delete(memberships).where(inArray(memberships.tenantId, createdInstituteIds));
        await tx.delete(institutes).where(inArray(institutes.id, createdInstituteIds));
      });
    }
    // First admins resolved by the owner's requests reference the owner's user as creator.
    await withAdmin(result.db, mkAdminCtx('test:first-admin'), async (tx) => {
      await tx.delete(userProfiles).where(eq(userProfiles.createdBy, owner.userId));
      await tx.delete(phoneNumbers).where(eq(phoneNumbers.createdBy, owner.userId));
      await tx.delete(users).where(eq(users.createdBy, owner.userId));
    });
    await cleanupTestTeacher(result.db, teacher);
    await cleanupTestInstitute(result.db, institute);
    await cleanupTestReseller(result.db, owner);
    await cleanupTestReseller(result.db, otherReseller);
    await result?.close();
  });

  it.each([
    ['the institute admin', () => institute],
    ['a teacher', () => teacher],
  ])('refuses the field to %s reading their own institute', async (_who, member) => {
    const { userId, membershipId, roleId } = member();
    const res = await gqlRequest<{ myInstitute: { id: string; firstAdmin: unknown } | null }>(
      result.httpServer,
      {
        query: MY_INSTITUTE,
        token: createInstituteToken({
          sub: userId,
          tenantId: institute.tenantId,
          membershipId,
          roleId,
        }),
      },
    );

    expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(res.data?.myInstitute?.firstAdmin ?? null).toBeNull();
    expect(JSON.stringify(res.data ?? null)).not.toContain(FIRST_ADMIN.email);
  });

  const adminGet = (id: string) =>
    gqlRequest<{ adminGetInstitute: { firstAdmin: FirstAdminData | null } }>(result.httpServer, {
      query: ADMIN_GET,
      variables: { id },
      token: platformToken(),
    });

  const resellerGet = (id: string) =>
    gqlRequest<{ resellerGetInstitute: { firstAdmin: FirstAdminData | null } }>(result.httpServer, {
      query: RESELLER_GET,
      variables: { id },
      token: resellerToken(owner),
    });

  async function requestInstitute(firstAdmin: {
    firstName: string;
    lastName?: string;
    email: string;
    phone?: string;
  }): Promise<string> {
    const res = await gqlRequest<{ resellerCreateInstituteRequest: { id: string } }>(
      result.httpServer,
      {
        query: CREATE_REQUEST,
        variables: {
          input: {
            name: { en: 'First Admin Visibility' },
            slug: `first-admin-visibility-${randomUUID().slice(0, 8)}`,
            firstAdmin,
          },
        },
        token: resellerToken(owner),
      },
    );
    expect(res.errors).toBeUndefined();
    const id = res.data?.resellerCreateInstituteRequest.id;
    assert(id);
    createdInstituteIds.push(id);
    return id;
  }

  it('returns every detail to the platform', async () => {
    const res = await adminGet(institute.tenantId);

    expect(res.errors).toBeUndefined();
    expect(res.data?.adminGetInstitute.firstAdmin).toEqual({
      ...FIRST_ADMIN,
      detailsWithheld: false,
    });
  });

  it('returns only the email to the owning reseller for an account it did not create', async () => {
    const res = await resellerGet(institute.tenantId);

    expect(res.errors).toBeUndefined();
    expect(res.data?.resellerGetInstitute.firstAdmin).toEqual(WITHHELD);
    expectNoPersonalDetails(res);
  });

  it('withholds an existing account named in a reseller request from that reseller only', async () => {
    // The reseller types a different name and phone; neither may change or reveal the account.
    const id = await requestInstitute({
      firstName: 'Typed',
      lastName: 'Name',
      email: FIRST_ADMIN.email.toUpperCase(),
      phone: uniqueMobile(),
    });

    const asReseller = await resellerGet(id);
    expect(asReseller.errors).toBeUndefined();
    expect(asReseller.data?.resellerGetInstitute.firstAdmin).toEqual(WITHHELD);
    expectNoPersonalDetails(asReseller);

    const asPlatform = await adminGet(id);
    expect(asPlatform.errors).toBeUndefined();
    expect(asPlatform.data?.adminGetInstitute.firstAdmin).toEqual({
      ...FIRST_ADMIN,
      detailsWithheld: false,
    });
  });

  it('returns every detail to the reseller for an account its own request created', async () => {
    const created = {
      firstName: 'Anjali',
      lastName: 'Verma',
      email: `anjali-${randomUUID().slice(0, 8)}@institute.test`,
      phone: uniqueMobile(),
    };
    const id = await requestInstitute(created);

    const res = await resellerGet(id);

    expect(res.errors).toBeUndefined();
    expect(res.data?.resellerGetInstitute.firstAdmin).toEqual({
      ...created,
      detailsWithheld: false,
    });
  });

  it('gives another reseller neither the institute nor its first admin', async () => {
    const res = await gqlRequest<{ resellerGetInstitute: { firstAdmin: FirstAdminData } | null }>(
      result.httpServer,
      {
        query: RESELLER_GET,
        variables: { id: institute.tenantId },
        token: resellerToken(otherReseller),
      },
    );

    expect(res.errors?.[0]?.extensions?.code).toBe('INSTITUTE_NOT_FOUND');
    expect(res.data?.resellerGetInstitute ?? null).toBeNull();
  });

  it('resolves the first admin to a new dormant user, email trimmed and lower-cased', async () => {
    const email = `meera.joshi-${randomUUID().slice(0, 8)}@institute.test`;
    const slug = `first-admin-email-${randomUUID().slice(0, 8)}`;
    const res = await gqlRequest<{ resellerCreateInstituteRequest: { id: string } }>(
      result.httpServer,
      {
        query: CREATE_REQUEST,
        variables: {
          input: {
            name: { en: 'Email Normalisation' },
            slug,
            type: 'COACHING',
            firstAdmin: { firstName: 'Meera', email: `  ${email.toUpperCase()}  ` },
          },
        },
        token: resellerToken(owner),
      },
    );
    expect(res.errors).toBeUndefined();
    const id = res.data?.resellerCreateInstituteRequest.id;
    assert(id);
    createdInstituteIds.push(id);

    const [row] = await withAdmin(result.db, mkAdminCtx('test:first-admin'), (tx) =>
      tx
        .select({
          email: users.email,
          username: users.username,
          mustChangePassword: users.mustChangePassword,
          firstName: userProfiles.firstName,
          lastName: userProfiles.lastName,
        })
        .from(institutes)
        .innerJoin(users, eq(users.id, institutes.firstAdminUserId))
        .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(eq(institutes.id, id)),
    );
    expect(row).toEqual({
      email,
      username: email,
      mustChangePassword: true,
      firstName: { en: 'Meera' },
      lastName: null,
    });
    const instituteMemberships = await withAdmin(result.db, mkAdminCtx('test:first-admin'), (tx) =>
      tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.tenantId, id)),
    );
    expect(instituteMemberships).toEqual([]);
  });

  it('refuses a new first admin whose mobile another account owns and creates nothing', async () => {
    const email = `phone-taken-${randomUUID().slice(0, 8)}@institute.test`;
    const slug = `first-admin-phone-${randomUUID().slice(0, 8)}`;

    const res = await gqlRequest(result.httpServer, {
      query: CREATE_REQUEST,
      variables: {
        input: {
          name: { en: 'Taken Phone' },
          slug,
          firstAdmin: { firstName: 'Asha', email, phone: FIRST_ADMIN.phone },
        },
      },
      token: resellerToken(owner),
    });

    // Same answer as an unusable email: the form must not reveal which numbers are registered.
    expect(res.errors?.[0]?.extensions?.code).toBe('INSTITUTE_ADMIN_UNAVAILABLE');
    expect(res.errors?.[0]?.message).toBe('These first admin details cannot be used');
    const state = await withAdmin(result.db, mkAdminCtx('test:first-admin'), async (tx) => ({
      institutes: await tx
        .select({ id: institutes.id })
        .from(institutes)
        .where(eq(institutes.slug, slug)),
      users: await tx.select({ id: users.id }).from(users).where(eq(users.email, email)),
    }));
    expect(state).toEqual({ institutes: [], users: [] });
  });

  it('ignores a taken mobile when the email belongs to an existing account', async () => {
    const otherPhone = uniqueMobile();
    await identity.createUser({
      email: `phone-owner-${randomUUID().slice(0, 8)}@institute.test`,
      username: `phone-owner-${randomUUID().slice(0, 8)}`,
      phone: { countryCode: '+91', number: otherPhone },
      actorId: SYSTEM_USER_ID,
    });

    const id = await requestInstitute({
      firstName: 'Typed',
      email: FIRST_ADMIN.email,
      phone: otherPhone,
    });

    const asPlatform = await adminGet(id);
    expect(asPlatform.errors).toBeUndefined();
    expect(asPlatform.data?.adminGetInstitute.firstAdmin).toEqual({
      ...FIRST_ADMIN,
      detailsWithheld: false,
    });
  });

  it('refuses an account whose email is not verified, unless the same person created it', async () => {
    // Someone else created this account and may hold its password (SF-045).
    const squatted = `squatted-${randomUUID().slice(0, 8)}@institute.test`;
    await identity.createUser({ email: squatted, username: squatted, actorId: SYSTEM_USER_ID });
    const request = (email: string, slug: string) =>
      gqlRequest<{ resellerCreateInstituteRequest: { id: string } }>(result.httpServer, {
        query: CREATE_REQUEST,
        variables: {
          input: {
            name: { en: 'Unverified Email' },
            slug,
            firstAdmin: { firstName: 'Asha', email },
          },
        },
        token: resellerToken(owner),
      });

    const refusedSlug = `first-admin-unverified-${randomUUID().slice(0, 8)}`;
    const refused = await request(squatted, refusedSlug);
    expect(refused.errors?.[0]?.extensions?.code).toBe('INSTITUTE_ADMIN_UNAVAILABLE');
    expect(refused.errors?.[0]?.message).toBe('These first admin details cannot be used');
    const rows = await withAdmin(result.db, mkAdminCtx('test:first-admin'), (tx) =>
      tx.select({ id: institutes.id }).from(institutes).where(eq(institutes.slug, refusedSlug)),
    );
    expect(rows).toEqual([]);

    // Once the owner verifies the address it identifies them to anyone.
    await withAdmin(result.db, mkAdminCtx('test:first-admin'), (tx) =>
      tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, squatted)),
    );
    const accepted = await request(squatted, `first-admin-verified-${randomUUID().slice(0, 8)}`);
    expect(accepted.errors).toBeUndefined();
    const acceptedId = accepted.data?.resellerCreateInstituteRequest.id;
    assert(acceptedId);
    createdInstituteIds.push(acceptedId);

    // An account this reseller user created in an earlier request is reused without verification.
    const own = `own-${randomUUID().slice(0, 8)}@institute.test`;
    for (const slug of ['own-first', 'own-second']) {
      const res = await request(own, `${slug}-${randomUUID().slice(0, 8)}`);
      expect(res.errors).toBeUndefined();
      const id = res.data?.resellerCreateInstituteRequest.id;
      assert(id);
      createdInstituteIds.push(id);
    }
  });

  it('refuses a request whose first admin email cannot be used and stores no institute', async () => {
    const email = `taken-${randomUUID().slice(0, 8)}@institute.test`;
    // Another account uses the address as its Roviq ID, so it cannot identify one person.
    await identity.createUser({
      email: `other-${randomUUID().slice(0, 8)}@institute.test`,
      username: email,
      actorId: SYSTEM_USER_ID,
    });
    const slug = `first-admin-taken-${randomUUID().slice(0, 8)}`;

    const res = await gqlRequest(result.httpServer, {
      query: CREATE_REQUEST,
      variables: {
        input: { name: { en: 'Unusable Email' }, slug, firstAdmin: { firstName: 'Asha', email } },
      },
      token: resellerToken(owner),
    });

    expect(res.errors?.[0]?.extensions?.code).toBe('INSTITUTE_ADMIN_UNAVAILABLE');
    const rows = await withAdmin(result.db, mkAdminCtx('test:first-admin'), (tx) =>
      tx.select({ id: institutes.id }).from(institutes).where(eq(institutes.slug, slug)),
    );
    expect(rows).toEqual([]);
  });

  it('leaves a rejected request without any membership and keeps its user', async () => {
    const email = `rejected-${randomUUID().slice(0, 8)}@institute.test`;
    const requested = await gqlRequest<{ resellerCreateInstituteRequest: { id: string } }>(
      result.httpServer,
      {
        query: CREATE_REQUEST,
        variables: {
          input: {
            name: { en: 'Rejected Request' },
            slug: `first-admin-rejected-${randomUUID().slice(0, 8)}`,
            firstAdmin: { firstName: 'Asha', email },
          },
        },
        token: resellerToken(owner),
      },
    );
    expect(requested.errors).toBeUndefined();
    const id = requested.data?.resellerCreateInstituteRequest.id;
    assert(id);
    createdInstituteIds.push(id);

    const rejected = await gqlRequest(result.httpServer, {
      query: `mutation ($id: ID!) { adminRejectInstitute(id: $id, reason: "Duplicate") { id status } }`,
      variables: { id },
      token: platformToken(),
    });
    expect(rejected.errors).toBeUndefined();

    const state = await withAdmin(result.db, mkAdminCtx('test:first-admin'), async (tx) => ({
      memberships: await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.tenantId, id)),
      users: await tx.select({ email: users.email }).from(users).where(eq(users.email, email)),
    }));
    expect(state).toEqual({ memberships: [], users: [{ email }] });
  });
});
