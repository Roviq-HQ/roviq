/**
 * Reseller settings (ROV-186) — full resolver pipeline against real PostgreSQL:
 * real role abilities through CASL, the `reseller_own_update` policy and the
 * column grants, and the stored row after each change.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { ErrorCode, type ResellerSystemRoleName } from '@roviq/common-types';
import {
  files,
  mkAdminCtx,
  provisionResellerSystemRoles,
  resellerMemberships,
  resellers,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestReseller,
  createIntegrationApp,
  createResellerToken,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const PROFILE = `id name slug tier status isSystem customDomain registrationNumber registrationState version
  logo { id } favicon { id }
  branding { primaryColor secondaryColor theme customCss }
  contact { phones { countryCode number isPrimary isWhatsappEnabled label } emails { address isPrimary label } }
  address { line1 city district state postalCode country }`;
const MY_PROFILE = `query { resellerMyProfile { ${PROFILE} } }`;
const UPDATE_PROFILE = `mutation($input: ResellerUpdateProfileInput!) {
  resellerUpdateProfile(input: $input) { ${PROFILE} }
}`;
const UPDATE_BRANDING = `mutation($input: ResellerUpdateBrandingInput!) {
  resellerUpdateBranding(input: $input) { ${PROFILE} }
}`;

interface Profile {
  id: string;
  name: string;
  slug: string;
  version: number;
  registrationNumber: string | null;
  registrationState: string | null;
  branding: Record<string, string | null> | null;
  contact: { phones: { number: string }[]; emails: { address: string }[] };
  address: { line1: string; city: string } | null;
}

describe('Reseller settings (integration)', () => {
  let result: IntegrationAppResult;
  let reseller: TestReseller;
  let other: TestReseller;
  let roleIds: Record<ResellerSystemRoleName, string>;

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[2]) =>
    withAdmin(result.db, mkAdminCtx('test:reseller-settings'), fn);

  const gql = (query: string, variables: Record<string, unknown> | undefined, token: string) =>
    gqlRequest(result.httpServer, { query, variables, token });

  const codeOf = (response: Awaited<ReturnType<typeof gql>>) =>
    response.errors?.[0]?.extensions?.code;

  /** A token for the reseller's one staff member, after giving them `role`. */
  async function tokenAs(role: ResellerSystemRoleName): Promise<string> {
    await admin((tx) =>
      tx
        .update(resellerMemberships)
        .set({ roleId: roleIds[role], abilities: [] })
        .where(eq(resellerMemberships.id, reseller.membershipId)),
    );
    return createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: roleIds[role],
    });
  }

  const storedRow = async (resellerId: string) => {
    const [row] = await admin((tx) =>
      tx.select().from(resellers).where(eq(resellers.id, resellerId)),
    );
    assert(row);
    return row;
  };

  async function currentProfile(token: string): Promise<Profile> {
    const response = await gql(MY_PROFILE, undefined, token);
    expect(response.errors).toBeUndefined();
    return response.data?.resellerMyProfile as Profile;
  }

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    reseller = await createTestReseller(result.db);
    other = await createTestReseller(result.db);
    roleIds = await admin((tx) =>
      provisionResellerSystemRoles(tx, reseller.resellerId, reseller.userId),
    );
  });

  afterAll(async () => {
    await cleanupTestReseller(result.db, reseller);
    await cleanupTestReseller(result.db, other);
    await result?.close();
  });

  describe('reading', () => {
    it("reseller_full_admin reads its own reseller and nobody else's", async () => {
      const profile = await currentProfile(await tokenAs('reseller_full_admin'));
      expect(profile.id).toBe(reseller.resellerId);
      expect(profile.id).not.toBe(other.resellerId);
    });

    // ROV-284: the support and viewer roles carry an explicit list without the reseller record.
    it.each(['reseller_support_admin', 'reseller_viewer'] as const)('refuses %s', async (role) => {
      const response = await gql(MY_PROFILE, undefined, await tokenAs(role));
      expect(codeOf(response)).toBe('FORBIDDEN');
      expect(response.data).toBeNull();
    });

    it('refuses a request without a token', async () => {
      const response = await gqlRequest(result.httpServer, { query: MY_PROFILE });
      expect(codeOf(response)).toBe('UNAUTHENTICATED');
    });
  });

  describe('editing the profile', () => {
    it('stores the name, registration, contact and address, and bumps the version', async () => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);

      const response = await gql(
        UPDATE_PROFILE,
        {
          input: {
            version: before.version,
            name: 'Settings Spec Partners',
            registrationNumber: 'U80301RJ2020PTC012345',
            registrationState: 'RAJASTHAN',
            contact: {
              phones: [
                {
                  countryCode: '+91',
                  number: '9876543210',
                  isPrimary: true,
                  isWhatsappEnabled: false,
                  label: 'Office',
                },
              ],
              emails: [{ address: 'hello@partners.test', isPrimary: true, label: 'Support' }],
            },
            address: {
              line1: '12 MI Road',
              city: 'Jaipur',
              district: 'Jaipur',
              state: 'Rajasthan',
              postalCode: '302001',
              country: 'IN',
            },
          },
        },
        token,
      );
      expect(response.errors).toBeUndefined();
      const updated = response.data?.resellerUpdateProfile as Profile;
      expect(updated.version).toBe(before.version + 1);
      expect(updated.slug).toBe(before.slug);

      const row = await storedRow(reseller.resellerId);
      expect(row.name).toBe('Settings Spec Partners');
      expect(row.registrationNumber).toBe('U80301RJ2020PTC012345');
      expect(row.registrationState).toBe('RAJASTHAN');
      expect(row.contact.phones[0]?.number).toBe('9876543210');
      expect(row.contact.emails[0]?.address).toBe('hello@partners.test');
      expect(row.address?.city).toBe('Jaipur');
      expect(row.updatedBy).toBe(reseller.userId);
    });

    it('clears registration and address when they are sent as null', async () => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);
      const response = await gql(
        UPDATE_PROFILE,
        {
          input: {
            version: before.version,
            registrationNumber: null,
            registrationState: null,
            address: null,
          },
        },
        token,
      );
      expect(response.errors).toBeUndefined();
      const row = await storedRow(reseller.resellerId);
      expect(row.registrationNumber).toBeNull();
      expect(row.registrationState).toBeNull();
      expect(row.address).toBeNull();
      expect(row.name).toBe('Settings Spec Partners');
    });

    it('refuses a stale version and leaves the row alone', async () => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);
      const response = await gql(
        UPDATE_PROFILE,
        { input: { version: before.version - 1, name: 'Lost Update' } },
        token,
      );
      expect(codeOf(response)).toBe(ErrorCode.CONCURRENT_MODIFICATION);
      expect((await storedRow(reseller.resellerId)).name).toBe(before.name);
    });

    it.each(['reseller_support_admin', 'reseller_viewer'] as const)('refuses %s', async (role) => {
      const token = await tokenAs(role);
      const before = await storedRow(reseller.resellerId);
      const response = await gql(
        UPDATE_PROFILE,
        { input: { version: before.version, name: 'Not Allowed' } },
        token,
      );
      expect(codeOf(response)).toBe('FORBIDDEN');
      expect((await storedRow(reseller.resellerId)).name).toBe(before.name);
    });

    it('has no field for slug, tier or custom domain', async () => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);
      for (const field of ['slug', 'tier', 'customDomain', 'status']) {
        await expect(
          gql(UPDATE_PROFILE, { input: { version: before.version, [field]: 'x' } }, token),
        ).rejects.toThrow(`Field \\"${field}\\" is not defined`);
      }
      expect((await storedRow(reseller.resellerId)).version).toBe(before.version);
    });
  });

  describe('editing the branding', () => {
    it('stores colours, theme and stylesheet', async () => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);

      const response = await gql(
        UPDATE_BRANDING,
        {
          input: {
            version: before.version,
            primaryColor: '#0F766E',
            secondaryColor: '#F1F5F9',
            theme: 'DARK',
            customCss: '.brand-header { letter-spacing: 0.02em; }',
          },
        },
        token,
      );
      expect(response.errors).toBeUndefined();
      expect((await storedRow(reseller.resellerId)).branding).toEqual({
        primaryColor: '#0F766E',
        secondaryColor: '#F1F5F9',
        theme: 'DARK',
        customCss: '.brand-header { letter-spacing: 0.02em; }',
      });
    });

    it('resets a value sent as null and leaves omitted ones', async () => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);
      const response = await gql(
        UPDATE_BRANDING,
        { input: { version: before.version, secondaryColor: null, customCss: null } },
        token,
      );
      expect(response.errors).toBeUndefined();
      expect((await storedRow(reseller.resellerId)).branding).toEqual({
        primaryColor: '#0F766E',
        theme: 'DARK',
      });
    });

    it.each([
      ['a colour that is not six-digit hex', { primaryColor: 'red' }],
      ['a stylesheet that imports', { customCss: '@import "https://evil.example/x.css";' }],
      ['a stylesheet that loads a URL', { customCss: '.a { background: url(//evil.example/p); }' }],
      ['a stylesheet that closes its element', { customCss: '</style><script>x</script>' }],
      ['a stylesheet with an escape', { customCss: '.a { background: \\75rl(x); }' }],
      ['a stylesheet over the size limit', { customCss: `.a{}${' '.repeat(20_000)}` }],
    ])('refuses %s', async (_label, fields) => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);
      const response = await gql(
        UPDATE_BRANDING,
        { input: { version: before.version, ...fields } },
        token,
      );
      expect(response.errors).toBeDefined();
      expect((await storedRow(reseller.resellerId)).version).toBe(before.version);
    });

    it('refuses an unknown theme', async () => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);
      await expect(
        gql(UPDATE_BRANDING, { input: { version: before.version, theme: 'NEON' } }, token),
      ).rejects.toThrow('does not exist in \\"ResellerBrandingTheme\\" enum');
    });

    it('refuses a logo id that is not a pending upload of the caller', async () => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);
      // A pending logo that belongs to another reseller: unreadable, so indistinguishable from none.
      const [foreign] = await admin((tx) =>
        tx
          .insert(files)
          .values({
            resellerId: other.resellerId,
            visibility: 'PUBLIC',
            purpose: 'RESELLER_LOGO',
            objectKey: `resellers/${other.resellerId}/reseller-logo/${randomUUID()}.png`,
            originalName: 'logo.png',
            contentType: 'image/png',
            sizeBytes: 10,
            uploadedBy: reseller.userId,
            createdBy: reseller.userId,
            updatedBy: reseller.userId,
          })
          .returning({ id: files.id }),
      );
      assert(foreign);
      try {
        for (const logoFileId of [foreign.id, randomUUID()]) {
          const response = await gql(
            UPDATE_BRANDING,
            { input: { version: before.version, logoFileId } },
            token,
          );
          expect(codeOf(response)).toBe(ErrorCode.FILE_NOT_FOUND);
        }
        const row = await storedRow(reseller.resellerId);
        expect(row.version).toBe(before.version);
        expect(row.logoFileId).toBeNull();
      } finally {
        await admin((tx) => tx.delete(files).where(eq(files.id, foreign.id)));
      }
    });

    it('accepts null for a logo and favicon that are not set', async () => {
      const token = await tokenAs('reseller_full_admin');
      const before = await currentProfile(token);
      const response = await gql(
        UPDATE_BRANDING,
        { input: { version: before.version, logoFileId: null, faviconFileId: null } },
        token,
      );
      expect(response.errors).toBeUndefined();
      expect(response.data?.resellerUpdateBranding).toMatchObject({ logo: null, favicon: null });
    });

    it('refuses a viewer', async () => {
      const token = await tokenAs('reseller_viewer');
      const before = await storedRow(reseller.resellerId);
      const response = await gql(
        UPDATE_BRANDING,
        { input: { version: before.version, primaryColor: '#000000' } },
        token,
      );
      expect(codeOf(response)).toBe('FORBIDDEN');
    });
  });

  it("never touches another reseller's row", async () => {
    const untouched = await storedRow(other.resellerId);
    expect(untouched.version).toBe(1);
    expect(untouched.branding).toEqual({});
  });
});
