/**
 * Institute branding images through the real stack: an image is uploaded, attached with
 * `updateInstituteBranding`, served from a public link that needs no sign-in, and shown as the
 * institute's logo when its members log in.
 */
import assert from 'node:assert';
import { ErrorCode, FilePurpose } from '@roviq/common-types';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E_USERS } from '../../shared/e2e-users';
import {
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsTeacher,
} from './helpers/auth';
import { gql } from './helpers/gql-client';

interface Ticket {
  fileId: string;
  uploadUrl: string;
  headers: { name: string; value: string }[];
}
interface Image {
  id: string;
  contentType: string;
  url: string | null;
  width: number | null;
  height: number | null;
}
interface Branding {
  primaryColor: string | null;
  logo: Image | null;
  favicon: Image | null;
  coverImage: Image | null;
}
interface UploadFile {
  name: string;
  type: string;
  body: Buffer;
}
interface BrandingInput {
  logoFileId?: string | null;
  faviconFileId?: string | null;
  coverImageFileId?: string | null;
  primaryColor?: string;
}

const REQUEST_UPLOAD = `mutation RequestUpload($input: RequestFileUploadInput!) {
  requestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
}`;
const BRANDING_FIELDS = `
  primaryColor
  logo { id contentType url(variant: MD) width height }
  favicon { id contentType url(variant: SM) width height }
  coverImage { id contentType url(variant: FULL) width height }
`;
const UPDATE_BRANDING = `mutation UpdateBranding($input: UpdateInstituteBrandingInput!) {
  updateInstituteBranding(input: $input) { id branding { ${BRANDING_FIELDS} } }
}`;
const MY_BRANDING = `query MyBranding { myInstitute { id branding { ${BRANDING_FIELDS} } } }`;
const LOGIN = `mutation InstituteLogin($username: String!, $password: String!) {
  instituteLogin(username: $username, password: $password) {
    memberships { tenantId instituteLogoUrl }
  }
}`;

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

async function picture(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 64, b: 175 } },
  })
    .png()
    .toBuffer();
}

describe('Institute branding images E2E', () => {
  let tokenA: string;
  let tenantA: string;
  let tokenB: string;
  let logo: UploadFile;
  let wide: UploadFile;

  function requestUpload(token: string | undefined, purpose: FilePurpose, file: UploadFile) {
    return gql<{ requestFileUpload: Ticket }>(
      REQUEST_UPLOAD,
      {
        input: {
          purpose,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.body.length,
        },
      },
      token,
    );
  }

  async function upload(token: string, purpose: FilePurpose, file: UploadFile): Promise<string> {
    const res = await requestUpload(token, purpose, file);
    expect(res.errors).toBeUndefined();
    const ticket = res.data?.requestFileUpload;
    assert(ticket);
    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      body: file.body,
      headers: Object.fromEntries(ticket.headers.map((h) => [h.name, h.value])),
    });
    expect(put.status).toBe(200);
    return ticket.fileId;
  }

  function updateBranding(token: string | undefined, input: BrandingInput) {
    return gql<{ updateInstituteBranding: { branding: Branding } }>(
      UPDATE_BRANDING,
      { input },
      token,
    );
  }

  async function savedBranding(token: string): Promise<Branding> {
    const res = await gql<{ myInstitute: { branding: Branding } }>(MY_BRANDING, undefined, token);
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.myInstitute.branding;
  }

  async function logoAtLogin(): Promise<string | null | undefined> {
    const res = await gql<{
      instituteLogin: { memberships: { tenantId: string; instituteLogoUrl: string | null }[] };
    }>(LOGIN, {
      username: E2E_USERS.INSTITUTE_ADMIN.username,
      password: E2E_USERS.INSTITUTE_ADMIN.password,
    });
    expect(res.errors).toBeUndefined();
    return res.data?.instituteLogin.memberships.find((m) => m.tenantId === tenantA)
      ?.instituteLogoUrl;
  }

  beforeAll(async () => {
    ({ accessToken: tokenA, tenantId: tenantA } = await loginAsInstituteAdmin());
    ({ accessToken: tokenB } = await loginAsInstituteAdminSecondInstitute());
    logo = { name: 'logo.png', type: 'image/png', body: await picture(800, 400) };
    wide = { name: 'campus.png', type: 'image/png', body: await picture(2400, 600) };
  });

  // Other suites read this institute; leave it without images, as seeded.
  afterAll(async () => {
    const res = await updateBranding(tokenA, {
      logoFileId: null,
      faviconFileId: null,
      coverImageFileId: null,
    });
    expect(res.errors).toBeUndefined();
  });

  describe('the logo', () => {
    let logoId: string;
    let logoUrl: string;

    it('should attach an uploaded logo and serve it from a public link', async () => {
      logoId = await upload(tokenA, FilePurpose.INSTITUTE_LOGO, logo);

      const res = await updateBranding(tokenA, { logoFileId: logoId });

      expect(res.errors).toBeUndefined();
      const saved = res.data?.updateInstituteBranding.branding.logo;
      assert(saved?.url);
      logoUrl = saved.url;
      expect(saved).toEqual({
        id: logoId,
        contentType: 'image/webp',
        url: logoUrl,
        width: 800,
        height: 400,
      });
      expect(new URL(logoUrl).search).toBe('');
      expect(new URL(logoUrl).pathname).toContain(`/institutes/${tenantA}/institute-logo/`);
      // No Authorization header: the login page shows it before anyone signs in.
      const image = await fetch(logoUrl);
      expect(image.status).toBe(200);
      const stored = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
      expect([stored.format, stored.width, stored.height]).toEqual(['webp', 512, 256]);
    });

    it('should show the logo with the institute when a member logs in', async () => {
      expect(await logoAtLogin()).toBe(logoUrl);
    });

    it('should keep the logo when another branding field changes', async () => {
      const res = await updateBranding(tokenA, { primaryColor: '#0f5132' });

      expect(res.errors).toBeUndefined();
      expect(res.data?.updateInstituteBranding.branding.primaryColor).toBe('#0f5132');
      expect(res.data?.updateInstituteBranding.branding.logo?.id).toBe(logoId);
    });

    it('should not show the logo to another institute as its own', async () => {
      const other = await savedBranding(tokenB);

      expect(other?.logo ?? null).toBeNull();
    });

    it('should replace the logo with a new upload', async () => {
      const nextId = await upload(tokenA, FilePurpose.INSTITUTE_LOGO, logo);

      const res = await updateBranding(tokenA, { logoFileId: nextId });

      expect(res.errors).toBeUndefined();
      expect(res.data?.updateInstituteBranding.branding.logo?.id).toBe(nextId);
      // The replaced file is deleted: it can never be attached again.
      const again = await updateBranding(tokenA, { logoFileId: logoId });
      expect(codeOf(again)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should remove the logo when null is sent', async () => {
      const res = await updateBranding(tokenA, { logoFileId: null });

      expect(res.errors).toBeUndefined();
      expect(res.data?.updateInstituteBranding.branding.logo).toBeNull();
      expect((await savedBranding(tokenA)).logo).toBeNull();
      expect((await logoAtLogin()) ?? null).toBeNull();
    });
  });

  describe('favicon and cover image', () => {
    it('should store the favicon as a square and the cover image at its own shape', async () => {
      const faviconId = await upload(tokenA, FilePurpose.INSTITUTE_FAVICON, logo);
      const coverId = await upload(tokenA, FilePurpose.INSTITUTE_COVER, wide);

      const res = await updateBranding(tokenA, {
        faviconFileId: faviconId,
        coverImageFileId: coverId,
      });

      expect(res.errors).toBeUndefined();
      const branding = res.data?.updateInstituteBranding.branding;
      assert(branding?.favicon && branding.coverImage);
      expect([branding.favicon.id, branding.favicon.width, branding.favicon.height]).toEqual([
        faviconId,
        400,
        400,
      ]);
      expect([
        branding.coverImage.id,
        branding.coverImage.width,
        branding.coverImage.height,
      ]).toEqual([coverId, 1920, 480]);
    });
  });

  describe('refusals', () => {
    it('should refuse an upload made for a different branding image', async () => {
      const faviconId = await upload(tokenA, FilePurpose.INSTITUTE_FAVICON, logo);

      const res = await updateBranding(tokenA, { logoFileId: faviconId });

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it("should refuse another institute's upload", async () => {
      const foreign = await upload(tokenB, FilePurpose.INSTITUTE_LOGO, logo);

      const res = await updateBranding(tokenA, { logoFileId: foreign });

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should refuse a file that is not an image', async () => {
      const res = await requestUpload(tokenA, FilePurpose.INSTITUTE_LOGO, {
        name: 'logo.pdf',
        type: 'application/pdf',
        body: Buffer.from('%PDF-1.4\n'),
      });

      expect(codeOf(res)).toBe(ErrorCode.FILE_TYPE_NOT_ALLOWED);
    });

    it('should refuse an image whose content is not a picture', async () => {
      const fileId = await upload(tokenA, FilePurpose.INSTITUTE_LOGO, {
        name: 'logo.png',
        type: 'image/png',
        body: Buffer.from('not a png at all'),
      });

      const res = await updateBranding(tokenA, { logoFileId: fileId });

      expect(codeOf(res)).toBe(ErrorCode.FILE_IMAGE_INVALID);
    });

    it('should refuse a teacher, who may not change branding', async () => {
      const { accessToken } = await loginAsTeacher();

      const ticket = await requestUpload(accessToken, FilePurpose.INSTITUTE_LOGO, logo);
      const update = await updateBranding(accessToken, { primaryColor: '#000000' });

      expect(codeOf(ticket)).toBe(ErrorCode.FORBIDDEN);
      expect(codeOf(update)).toBe(ErrorCode.FORBIDDEN);
    });

    it('should refuse an unauthenticated request', async () => {
      const res = await updateBranding(undefined, { logoFileId: null });

      expect(codeOf(res)).toBe(ErrorCode.UNAUTHENTICATED);
    });
  });
});
