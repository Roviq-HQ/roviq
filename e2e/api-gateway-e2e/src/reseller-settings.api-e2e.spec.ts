/**
 * Reseller settings E2E (ROV-186) — on the running stack, as the seeded full
 * admin of the system reseller "Roviq Direct".
 *
 * Renaming, per-role refusals and the column grants need a second, non-system
 * reseller, so they live in
 * apps/api-gateway/src/reseller/settings/__tests__/reseller-settings.integration.spec.ts
 * and libs/database/src/__tests__/auth-invariants-db.integration.spec.ts.
 */
import assert from 'node:assert';
import { ErrorCode } from '@roviq/common-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import { loginAsInstituteAdmin, loginAsPlatformAdmin, loginAsReseller } from './helpers/auth';
import { gql } from './helpers/gql-client';
import { subscribeOnce } from './helpers/ws-client';

interface Branding {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  theme: string | null;
  customCss: string | null;
}

interface Profile {
  id: string;
  name: string;
  slug: string;
  isSystem: boolean;
  registrationNumber: string | null;
  registrationState: string | null;
  version: number;
  branding: Branding | null;
}

const PROFILE = `id name slug isSystem registrationNumber registrationState version
  branding { logoUrl primaryColor secondaryColor theme customCss }`;
const MY_PROFILE = `query { resellerMyProfile { ${PROFILE} } }`;
const UPDATE_PROFILE = `mutation UpdateProfile($input: ResellerUpdateProfileInput!) {
  resellerUpdateProfile(input: $input) { ${PROFILE} }
}`;
const UPDATE_BRANDING = `mutation UpdateBranding($input: ResellerUpdateBrandingInput!) {
  resellerUpdateBranding(input: $input) { ${PROFILE} }
}`;

const SUFFIX = Date.now().toString(36).toUpperCase();

describe('Reseller settings E2E', () => {
  let token: string;
  let original: Profile;

  const codeOf = (res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) =>
    res.errors?.[0]?.extensions?.code;

  async function current(): Promise<Profile> {
    const res = await gql<{ resellerMyProfile: Profile }>(MY_PROFILE, undefined, token);
    expect(res.errors).toBeUndefined();
    const profile = res.data?.resellerMyProfile;
    assert(profile);
    return profile;
  }

  beforeAll(async () => {
    token = (await loginAsReseller()).accessToken;
    original = await current();
  });

  afterAll(async () => {
    const now = await current();
    await gql(
      UPDATE_PROFILE,
      {
        input: {
          version: now.version,
          registrationNumber: original.registrationNumber,
          registrationState: original.registrationState,
        },
      },
      token,
    );
    const afterProfile = await current();
    await gql(
      UPDATE_BRANDING,
      {
        input: {
          version: afterProfile.version,
          primaryColor: original.branding?.primaryColor ?? null,
          secondaryColor: original.branding?.secondaryColor ?? null,
          theme: original.branding?.theme ?? null,
          customCss: original.branding?.customCss ?? null,
        },
      },
      token,
    );
  });

  it('returns the reseller the token belongs to', async () => {
    expect(original.id).toBe(SEED.RESELLER.id);
    expect(original.name).toBe(SEED.RESELLER.name);
    expect(original.isSystem).toBe(true);
  });

  it('refuses a request without a token and one from another scope', async () => {
    const anonymous = await gql(MY_PROFILE);
    expect(codeOf(anonymous)).toBe('UNAUTHENTICATED');

    const institute = await loginAsInstituteAdmin();
    const wrongScope = await gql(MY_PROFILE, undefined, institute.accessToken);
    expect(codeOf(wrongScope)).toBe('FORBIDDEN');

    const before = await current();
    const write = await gql(
      UPDATE_BRANDING,
      { input: { version: before.version, primaryColor: '#000000' } },
      institute.accessToken,
    );
    expect(codeOf(write)).toBe('FORBIDDEN');
    expect((await current()).version).toBe(before.version);
  });

  it('edits the registration and tells the platform', async () => {
    const admin = await loginAsPlatformAdmin();
    const event = subscribeOnce<{
      adminResellerUpdated: { id: string; registrationNumber: string };
    }>('subscription { adminResellerUpdated { id registrationNumber } }', {}, admin.accessToken);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const before = await current();
    const registrationNumber = `E2E-${SUFFIX}`;
    const res = await gql<{ resellerUpdateProfile: Profile }>(
      UPDATE_PROFILE,
      { input: { version: before.version, registrationNumber, registrationState: 'RAJASTHAN' } },
      token,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.resellerUpdateProfile.version).toBe(before.version + 1);

    const after = await current();
    expect(after.registrationNumber).toBe(registrationNumber);
    expect(after.registrationState).toBe('RAJASTHAN');
    expect(after.slug).toBe(before.slug);

    const delivered = await event;
    expect(delivered.adminResellerUpdated).toEqual({ id: SEED.RESELLER.id, registrationNumber });
  });

  it('does not let the system reseller be renamed', async () => {
    const before = await current();
    const res = await gql(
      UPDATE_PROFILE,
      { input: { version: before.version, name: 'Renamed Direct' } },
      token,
    );
    expect(codeOf(res)).toBe(ErrorCode.SYSTEM_RESELLER_PROTECTED);
    expect((await current()).name).toBe(SEED.RESELLER.name);
  });

  it('refuses a stale version', async () => {
    const before = await current();
    const res = await gql(
      UPDATE_PROFILE,
      { input: { version: before.version - 1, registrationNumber: 'STALE' } },
      token,
    );
    expect(codeOf(res)).toBe(ErrorCode.CONCURRENT_MODIFICATION);
    expect((await current()).registrationNumber).toBe(before.registrationNumber);
  });

  it('stores colours, theme and stylesheet, then resets the ones sent as null', async () => {
    const before = await current();
    const set = await gql<{ resellerUpdateBranding: Profile }>(
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
    expect(set.errors).toBeUndefined();
    expect(set.data?.resellerUpdateBranding.branding).toEqual({
      logoUrl: before.branding?.logoUrl ?? null,
      primaryColor: '#0F766E',
      secondaryColor: '#F1F5F9',
      theme: 'DARK',
      customCss: '.brand-header { letter-spacing: 0.02em; }',
    });

    const reset = await gql<{ resellerUpdateBranding: Profile }>(
      UPDATE_BRANDING,
      { input: { version: before.version + 1, secondaryColor: null, customCss: null } },
      token,
    );
    expect(reset.errors).toBeUndefined();
    expect(reset.data?.resellerUpdateBranding.branding).toEqual({
      logoUrl: before.branding?.logoUrl ?? null,
      primaryColor: '#0F766E',
      secondaryColor: null,
      theme: 'DARK',
      customCss: null,
    });
  });

  it.each([
    ['an import', '@import "https://evil.example/x.css";'],
    ['a remote URL', '.a { background: url(https://evil.example/p.png); }'],
    ['markup', '</style><script>alert(1)</script>'],
  ])('refuses a stylesheet containing %s', async (_label, customCss) => {
    const before = await current();
    const res = await gql(
      UPDATE_BRANDING,
      { input: { version: before.version, customCss } },
      token,
    );
    expect(res.errors).toBeDefined();
    expect((await current()).version).toBe(before.version);
  });
});
