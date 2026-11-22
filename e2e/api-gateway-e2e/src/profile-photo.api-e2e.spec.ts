/**
 * Profile pictures through the real stack. Each institute keeps its own picture of a person
 * (`setStudentPhoto` and the like): stored under the user, cropped square, owned by that
 * institute and shown nowhere else. The person's own account picture (`setMyProfilePhoto`)
 * is shown in every institute they belong to.
 *
 * RLS on person-owned files as each database role: `files-rls.integration.spec.ts`.
 */
import assert from 'node:assert';
import { ErrorCode, FilePurpose } from '@roviq/common-types';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../shared/seed-fixtures';
import {
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsStudent,
} from './helpers/auth';
import { gql } from './helpers/gql-client';

interface Ticket {
  fileId: string;
  uploadUrl: string;
  headers: { name: string; value: string }[];
}
interface Photo {
  id: string;
  contentType: string;
  width: number;
  height: number;
  placeholder: string | null;
  sm: string;
  md: string;
}

const REQUEST_UPLOAD = `mutation RequestUpload($input: RequestFileUploadInput!) {
  requestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
}`;
const SET_STUDENT_PHOTO = `mutation SetStudentPhoto($id: ID!, $fileId: ID) {
  setStudentPhoto(studentProfileId: $id, fileId: $fileId)
}`;
const SET_GUARDIAN_PHOTO = `mutation SetGuardianPhoto($id: ID!, $fileId: ID) {
  setGuardianPhoto(guardianProfileId: $id, fileId: $fileId)
}`;
const SET_MY_PHOTO = `mutation SetMyPhoto($fileId: ID) { setMyProfilePhoto(fileId: $fileId) }`;
const STUDENT_PHOTO = `query StudentPhoto($id: ID!) {
  getStudent(id: $id) {
    id
    profileImage {
      id contentType width height placeholder
      sm: url(variant: SM) md: url(variant: MD)
    }
  }
}`;
const MY_PHOTO = `query MyPhoto {
  myProfile {
    ... on MyStudentProfile { userProfile { profileImage { id } } }
    ... on MyStaffProfile { userProfile { profileImage { id } } }
    ... on MyGuardianProfile { userProfile { profileImage { id } } }
  }
}`;
const DOWNLOAD_URL = `mutation Download($fileId: ID!) { fileDownloadUrl(fileId: $fileId) }`;

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

describe('Profile photo E2E', () => {
  let tokenA: string;
  let tokenB: string;
  let photo: Buffer;

  async function requestUpload(token: string, subjectUserId?: string) {
    return gql<{ requestFileUpload: Ticket }>(
      REQUEST_UPLOAD,
      {
        input: {
          purpose: FilePurpose.PROFILE_PHOTO,
          fileName: 'portrait.jpg',
          contentType: 'image/jpeg',
          sizeBytes: photo.length,
          subjectUserId,
        },
      },
      token,
    );
  }

  async function upload(token: string, subjectUserId: string): Promise<string> {
    const res = await requestUpload(token, subjectUserId);
    expect(res.errors).toBeUndefined();
    const ticket = res.data?.requestFileUpload;
    assert(ticket);
    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      body: photo,
      headers: Object.fromEntries(ticket.headers.map((h) => [h.name, h.value])),
    });
    expect(put.status).toBe(200);
    return ticket.fileId;
  }

  async function studentPhoto(token: string): Promise<Photo | null> {
    const res = await gql<{ getStudent: { profileImage: Photo | null } }>(
      STUDENT_PHOTO,
      { id: SEED_IDS.STUDENT_PROFILE_1 },
      token,
    );
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.getStudent.profileImage;
  }

  beforeAll(async () => {
    ({ accessToken: tokenA } = await loginAsInstituteAdmin());
    ({ accessToken: tokenB } = await loginAsInstituteAdminSecondInstitute());
    // Wider than tall, so the square crop is visible in the stored sizes.
    photo = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: { r: 40, g: 110, b: 190 } },
    })
      .jpeg()
      .toBuffer();
  });

  describe('setting a student picture', () => {
    let firstFileId: string;

    it('should store it under the person, square, in three sizes', async () => {
      firstFileId = await upload(tokenA, SEED_IDS.USER_STUDENT);

      const set = await gql(
        SET_STUDENT_PHOTO,
        { id: SEED_IDS.STUDENT_PROFILE_1, fileId: firstFileId },
        tokenA,
      );

      expect(set.errors).toBeUndefined();
      const stored = await studentPhoto(tokenA);
      assert(stored);
      expect(stored).toMatchObject({
        id: firstFileId,
        contentType: 'image/webp',
        width: 1024,
        height: 1024,
      });
      expect(new URL(stored.sm).pathname).toContain(`/users/${SEED_IDS.USER_STUDENT}/`);
      const small = await sharp(
        Buffer.from(await (await fetch(stored.sm)).arrayBuffer()),
      ).metadata();
      expect([small.width, small.height]).toEqual([128, 128]);
      const medium = await sharp(
        Buffer.from(await (await fetch(stored.md)).arrayBuffer()),
      ).metadata();
      expect([medium.width, medium.height]).toEqual([512, 512]);
    });

    it('should give a thumbnail link that stays the same, so lists load from the browser cache', async () => {
      const first = await studentPhoto(tokenA);
      const second = await studentPhoto(tokenA);

      assert(first && second);
      expect(second.sm).toBe(first.sm);
      expect(new URL(first.sm).searchParams.get('X-Amz-Expires')).toBe('43200');
    });

    it("should leave the student's own account picture as it was", async () => {
      const { accessToken } = await loginAsStudent();

      const res = await gql<{
        myProfile: { userProfile: { profileImage: { id: string } | null } };
      }>(MY_PHOTO, undefined, accessToken);

      expect(res.errors).toBeUndefined();
      expect(res.data?.myProfile.userProfile.profileImage).toBeNull();
    });

    it('should refuse another institute reading the picture', async () => {
      const res = await gql(DOWNLOAD_URL, { fileId: firstFileId }, tokenB);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should delete the old picture when a new one replaces it', async () => {
      const replacement = await upload(tokenA, SEED_IDS.USER_STUDENT);

      const set = await gql(
        SET_STUDENT_PHOTO,
        { id: SEED_IDS.STUDENT_PROFILE_1, fileId: replacement },
        tokenA,
      );

      expect(set.errors).toBeUndefined();
      expect((await studentPhoto(tokenA))?.id).toBe(replacement);
      const old = await gql(DOWNLOAD_URL, { fileId: firstFileId }, tokenA);
      expect(codeOf(old)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should remove the picture when set to null', async () => {
      const set = await gql(
        SET_STUDENT_PHOTO,
        { id: SEED_IDS.STUDENT_PROFILE_1, fileId: null },
        tokenA,
      );

      expect(set.errors).toBeUndefined();
      expect(await studentPhoto(tokenA)).toBeNull();
    });
  });

  describe('refusals', () => {
    it('should refuse an upload that names no person', async () => {
      const res = await requestUpload(tokenA);

      expect(codeOf(res)).toBe(ErrorCode.BAD_REQUEST);
    });

    it('should refuse an upload for someone who is not a member of the institute', async () => {
      const res = await requestUpload(tokenB, SEED_IDS.USER_STUDENT);

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    });

    it("should refuse another institute setting this institute's student picture", async () => {
      const fileId = await upload(tokenA, SEED_IDS.USER_STUDENT);

      const res = await gql(SET_STUDENT_PHOTO, { id: SEED_IDS.STUDENT_PROFILE_1, fileId }, tokenB);

      expect(codeOf(res)).toBe(ErrorCode.STUDENT_NOT_FOUND);
      expect(await studentPhoto(tokenA)).toBeNull();
    });

    it("should refuse another institute removing this institute's student picture", async () => {
      const fileId = await upload(tokenA, SEED_IDS.USER_STUDENT);
      const set = await gql(SET_STUDENT_PHOTO, { id: SEED_IDS.STUDENT_PROFILE_1, fileId }, tokenA);
      expect(set.errors).toBeUndefined();

      const res = await gql(
        SET_STUDENT_PHOTO,
        { id: SEED_IDS.STUDENT_PROFILE_1, fileId: null },
        tokenB,
      );

      expect(codeOf(res)).toBe(ErrorCode.STUDENT_NOT_FOUND);
      expect((await studentPhoto(tokenA))?.id).toBe(fileId);
      await gql(SET_STUDENT_PHOTO, { id: SEED_IDS.STUDENT_PROFILE_1, fileId: null }, tokenA);
    });

    it('should refuse a picture uploaded for one person being set on another', async () => {
      const forStudent = await upload(tokenA, SEED_IDS.USER_STUDENT);

      const res = await gql(
        SET_GUARDIAN_PHOTO,
        { id: SEED_IDS.GUARDIAN_PROFILE_1, fileId: forStudent },
        tokenA,
      );

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should refuse a student setting a classmate picture', async () => {
      const { accessToken } = await loginAsStudent();

      const res = await gql(
        SET_STUDENT_PHOTO,
        { id: SEED_IDS.STUDENT_PROFILE_1, fileId: null },
        accessToken,
      );

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    });

    it('should refuse an unauthenticated request', async () => {
      const res = await gql(SET_MY_PHOTO, { fileId: null });

      expect(codeOf(res)).toBe(ErrorCode.UNAUTHENTICATED);
    });
  });

  describe('a person who is a member of two institutes', () => {
    it('should show their own picture in both institutes', async () => {
      const fileId = await upload(tokenA, SEED_IDS.USER_ADMIN);
      const set = await gql(SET_MY_PHOTO, { fileId }, tokenA);
      expect(set.errors).toBeUndefined();

      const read = (token: string) =>
        gql<{ myProfile: { userProfile: { profileImage: { id: string } | null } } }>(
          MY_PHOTO,
          undefined,
          token,
        );
      const [inFirst, inSecond] = [await read(tokenA), await read(tokenB)];

      expect(inFirst.data?.myProfile.userProfile.profileImage?.id).toBe(fileId);
      expect(inSecond.data?.myProfile.userProfile.profileImage?.id).toBe(fileId);

      const cleared = await gql(SET_MY_PHOTO, { fileId: null }, tokenB);
      expect(cleared.errors).toBeUndefined();
    });
  });
});
