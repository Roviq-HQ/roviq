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
import { ErrorCode, FilePurpose } from '@roviq/common-types';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import { loginAsInstituteAdmin, loginAsPlatformAdmin, loginAsReseller } from './helpers/auth';
import { gql } from './helpers/gql-client';
import { subscribeOnce } from './helpers/ws-client';

interface Branding {
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
  branding { primaryColor secondaryColor theme customCss }`;
const MY_PROFILE = `query { resellerMyProfile { ${PROFILE} } }`;
const UPDATE_PROFILE = `mutation UpdateProfile($input: ResellerUpdateProfileInput!) {
  resellerUpdateProfile(input: $input) { ${PROFILE} }
}`;
const UPDATE_BRANDING = `mutation UpdateBranding($input: ResellerUpdateBrandingInput!) {
  resellerUpdateBranding(input: $input) { ${PROFILE} }
}`;

interface Ticket {
  fileId: string;
  uploadUrl: string;
  headers: { name: string; value: string }[];
}
interface Image {
  id: string;
  contentType: string;
  width: number;
  height: number;
  url: string;
}

const IMAGE = 'id contentType width height';
const IMAGES = `query { resellerMyProfile {
  version
  logo { ${IMAGE} url(variant: MD) }
  favicon { ${IMAGE} url(variant: SM) }
} }`;
const RESELLER_REQUEST_UPLOAD = `mutation($input: RequestFileUploadInput!) {
  resellerRequestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
}`;
const INSTITUTE_REQUEST_UPLOAD = `mutation($input: RequestFileUploadInput!) {
  requestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
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

  describe('logo and favicon', () => {
    let wide: Buffer;

    async function images() {
      const res = await gql<{
        resellerMyProfile: { version: number; logo: Image | null; favicon: Image | null };
      }>(IMAGES, undefined, token);
      expect(res.errors).toBeUndefined();
      assert(res.data);
      return res.data.resellerMyProfile;
    }

    async function upload(purpose: FilePurpose): Promise<string> {
      const res = await gql<{ resellerRequestFileUpload: Ticket }>(
        RESELLER_REQUEST_UPLOAD,
        {
          input: {
            purpose,
            fileName: 'brand.png',
            contentType: 'image/png',
            sizeBytes: wide.length,
          },
        },
        token,
      );
      expect(res.errors).toBeUndefined();
      const ticket = res.data?.resellerRequestFileUpload;
      assert(ticket);
      const put = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body: wide,
        headers: Object.fromEntries(ticket.headers.map((h) => [h.name, h.value])),
      });
      expect(put.status).toBe(200);
      return ticket.fileId;
    }

    const setImages = async (input: Record<string, string | null>) =>
      gql<{ resellerUpdateBranding: { version: number } }>(
        UPDATE_BRANDING,
        { input: { version: (await images()).version, ...input } },
        token,
      );

    beforeAll(async () => {
      wide = await sharp({
        create: { width: 600, height: 200, channels: 3, background: { r: 15, g: 118, b: 110 } },
      })
        .png()
        .toBuffer();
    });

    afterAll(async () => {
      await setImages({ logoFileId: null, faviconFileId: null });
    });

    it('stores an uploaded logo in its own shape and serves it to anyone, without sign-in', async () => {
      const fileId = await upload(FilePurpose.RESELLER_LOGO);
      const res = await setImages({ logoFileId: fileId });
      expect(res.errors).toBeUndefined();

      const { logo } = await images();
      assert(logo);
      expect(logo).toMatchObject({
        id: fileId,
        contentType: 'image/webp',
        width: 600,
        height: 200,
      });
      expect(logo.url).toContain(`resellers/${SEED.RESELLER.id}/reseller-logo/${fileId}/md.webp`);
      expect(logo.url).not.toContain('X-Amz-Signature');

      const served = await fetch(logo.url);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/webp');
    });

    it('stores a favicon square, whatever shape was uploaded', async () => {
      const fileId = await upload(FilePurpose.RESELLER_FAVICON);
      const res = await setImages({ faviconFileId: fileId });
      expect(res.errors).toBeUndefined();

      const { favicon } = await images();
      assert(favicon);
      expect(favicon.id).toBe(fileId);
      expect(favicon.width).toBe(favicon.height);
    });

    it('replaces the logo with a new upload and keeps the favicon', async () => {
      const before = await images();
      const fileId = await upload(FilePurpose.RESELLER_LOGO);
      const res = await setImages({ logoFileId: fileId });
      expect(res.errors).toBeUndefined();

      const after = await images();
      expect(after.logo?.id).toBe(fileId);
      expect(after.logo?.id).not.toBe(before.logo?.id);
      expect(after.favicon?.id).toBe(before.favicon?.id);
    });

    it('refuses an upload made for the favicon as a logo, and one already attached', async () => {
      const before = await images();
      const asFavicon = await upload(FilePurpose.RESELLER_FAVICON);
      const wrongPurpose = await setImages({ logoFileId: asFavicon });
      expect(codeOf(wrongPurpose)).toBe(ErrorCode.FILE_NOT_FOUND);

      assert(before.logo);
      const reused = await setImages({ faviconFileId: before.logo.id });
      expect(codeOf(reused)).toBe(ErrorCode.FILE_NOT_FOUND);

      const after = await images();
      expect(after.version).toBe(before.version);
      expect(after.logo?.id).toBe(before.logo.id);
    });

    it('removes the logo when it is sent as null', async () => {
      const res = await setImages({ logoFileId: null });
      expect(res.errors).toBeUndefined();
      expect((await images()).logo).toBeNull();
    });

    it('keeps each upload purpose on its own portal', async () => {
      const institute = await loginAsInstituteAdmin();
      const input = {
        fileName: 'brand.png',
        contentType: 'image/png',
        sizeBytes: wide.length,
      };

      const fromInstitute = await gql(
        INSTITUTE_REQUEST_UPLOAD,
        { input: { ...input, purpose: FilePurpose.RESELLER_LOGO } },
        institute.accessToken,
      );
      expect(codeOf(fromInstitute)).toBe('FORBIDDEN');

      const instituteOnResellerMutation = await gql(
        RESELLER_REQUEST_UPLOAD,
        { input: { ...input, purpose: FilePurpose.RESELLER_LOGO } },
        institute.accessToken,
      );
      expect(codeOf(instituteOnResellerMutation)).toBe('FORBIDDEN');

      const fromReseller = await gql(
        RESELLER_REQUEST_UPLOAD,
        {
          input: {
            fileName: 'note.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1024,
            purpose: FilePurpose.LEAVE_ATTACHMENT,
          },
        },
        token,
      );
      expect(codeOf(fromReseller)).toBe('FORBIDDEN');
    });
  });
});
