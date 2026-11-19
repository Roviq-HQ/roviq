/**
 * File storage through the real stack: presigned upload to object storage, attach to a leave,
 * download, and the refusals enforced by storage itself and by the gateway.
 *
 * RLS on `files` as each database role is covered by `files-rls.integration.spec.ts`.
 */
import assert from 'node:assert';
import { ErrorCode, FilePurpose, LeaveType } from '@roviq/common-types';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../shared/seed-fixtures';
import {
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsPlatformAdmin,
  loginAsStudent,
} from './helpers/auth';
import { gql } from './helpers/gql-client';

interface Ticket {
  fileId: string;
  uploadUrl: string;
  headers: { name: string; value: string }[];
}
interface FileRef {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  url: string | null;
}
interface ImageRef extends FileRef {
  width: number | null;
  height: number | null;
  placeholder: string | null;
  sm: string | null;
  md: string | null;
}
interface Leave {
  id: string;
  files: FileRef[];
}

const REQUEST_UPLOAD = `mutation RequestUpload($input: RequestFileUploadInput!) {
  requestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
}`;
const APPLY_LEAVE = `mutation Apply($input: CreateLeaveInput!) {
  applyLeave(input: $input) { id files { id name contentType sizeBytes url } }
}`;
const UPDATE_LEAVE = `mutation Update($id: ID!, $input: UpdateLeaveInput!) {
  updateLeave(id: $id, input: $input) { id files { id name contentType sizeBytes url } }
}`;
const LEAVE = `query Leave($id: ID!) {
  leave(id: $id) { id files { id name contentType sizeBytes url } }
}`;
const APPLY_LEAVE_WITH_IMAGE = `mutation ApplyImage($input: CreateLeaveInput!) {
  applyLeave(input: $input) {
    id
    files {
      id name contentType sizeBytes width height placeholder
      url sm: url(variant: SM) md: url(variant: MD)
    }
  }
}`;
const LEAVE_IMAGE_LINKS = `query LeaveImage($id: ID!) {
  leave(id: $id) { files { id sm: url(variant: SM) } }
}`;
const DOWNLOAD_URL = `mutation Download($fileId: ID!) { fileDownloadUrl(fileId: $fileId) }`;

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]);
const NOT_A_PDF = Buffer.from('MZ this is an executable pretending to be a PDF');

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

async function requestUpload(
  token: string,
  overrides: Partial<{ fileName: string; contentType: string; sizeBytes: number }> = {},
) {
  return gql<{ requestFileUpload: Ticket }>(
    REQUEST_UPLOAD,
    {
      input: {
        purpose: FilePurpose.LEAVE_ATTACHMENT,
        fileName: 'medical-certificate.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
        ...overrides,
      },
    },
    token,
  );
}

async function put(ticket: Ticket, body: Buffer): Promise<number> {
  const res = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body,
    headers: Object.fromEntries(ticket.headers.map((h) => [h.name, h.value])),
  });
  return res.status;
}

async function uploadFile(
  token: string,
  body: Buffer = PDF,
  fileName = 'medical-certificate.pdf',
  contentType = 'application/pdf',
): Promise<string> {
  const res = await requestUpload(token, { sizeBytes: body.length, fileName, contentType });
  expect(res.errors).toBeUndefined();
  const ticket = res.data?.requestFileUpload;
  assert(ticket);
  expect(await put(ticket, body)).toBe(200);
  return ticket.fileId;
}

function applyLeave(token: string, userId: string, day: string, fileIds: string[]) {
  return gql<{ applyLeave: Leave }>(
    APPLY_LEAVE,
    {
      input: {
        userId,
        startDate: day,
        endDate: day,
        type: LeaveType.MEDICAL,
        reason: 'file storage e2e',
        fileIds,
      },
    },
    token,
  );
}

describe('File storage E2E', () => {
  let tokenA: string;
  let tokenB: string;
  let attachedFileId: string;
  let leaveId: string;

  beforeAll(async () => {
    ({ accessToken: tokenA } = await loginAsInstituteAdmin());
    ({ accessToken: tokenB } = await loginAsInstituteAdminSecondInstitute());
  });

  describe('upload, attach and download', () => {
    it('should attach an uploaded file to a leave and serve the same bytes back', async () => {
      attachedFileId = await uploadFile(tokenA, PDF, 'प्रमाण पत्र.pdf');

      const res = await applyLeave(tokenA, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2027-01-11', [
        attachedFileId,
      ]);

      expect(res.errors).toBeUndefined();
      const leave = res.data?.applyLeave;
      assert(leave);
      leaveId = leave.id;
      expect(leave.files).toHaveLength(1);
      const [file] = leave.files;
      assert(file?.url);
      expect(file).toMatchObject({
        id: attachedFileId,
        name: 'प्रमाण पत्र.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
      });
      const download = await fetch(file.url);
      expect(download.status).toBe(200);
      expect(Buffer.from(await download.arrayBuffer()).equals(PDF)).toBe(true);
      expect(download.headers.get('content-disposition')).toContain('attachment');
    });

    it('should keep serving the verified bytes when the upload URL is used again', async () => {
      const ticketRes = await requestUpload(tokenA);
      const ticket = ticketRes.data?.requestFileUpload;
      assert(ticket);
      expect(await put(ticket, PDF)).toBe(200);
      const attached = await applyLeave(tokenA, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2027-01-18', [
        ticket.fileId,
      ]);
      expect(attached.errors).toBeUndefined();
      const url = attached.data?.applyLeave.files[0]?.url;
      assert(url);

      // Same size and type, so storage accepts the write; it must not reach the served file.
      const replacement = Buffer.concat([Buffer.from('MZ-not-a'), Buffer.alloc(4097, 0x41)]);
      expect(replacement.length).toBe(PDF.length);
      await put(ticket, replacement);

      const served = Buffer.from(await (await fetch(url)).arrayBuffer());
      expect(served.equals(PDF)).toBe(true);
    });

    it('should refuse removing the only document from a leave of 3 or more days', async () => {
      const fileId = await uploadFile(tokenA);
      const created = await gql<{ applyLeave: Leave }>(
        APPLY_LEAVE,
        {
          input: {
            userId: SEED_IDS.MEMBERSHIP_ADMIN_INST1,
            startDate: '2027-02-01',
            endDate: '2027-02-04',
            type: LeaveType.MEDICAL,
            reason: 'file storage e2e',
            fileIds: [fileId],
          },
        },
        tokenA,
      );
      expect(created.errors).toBeUndefined();
      assert(created.data);

      const res = await gql(
        UPDATE_LEAVE,
        { id: created.data.applyLeave.id, input: { fileIds: [] } },
        tokenA,
      );

      expect(codeOf(res)).toBe(ErrorCode.LEAVE_DOCUMENT_REQUIRED);
    });

    it('should return the file again when the leave is read later', async () => {
      const res = await gql<{ leave: Leave }>(LEAVE, { id: leaveId }, tokenA);

      expect(res.errors).toBeUndefined();
      expect(res.data?.leave.files.map((file) => file.id)).toEqual([attachedFileId]);
    });

    it('should give a working short-lived URL through fileDownloadUrl', async () => {
      const res = await gql<{ fileDownloadUrl: string }>(
        DOWNLOAD_URL,
        { fileId: attachedFileId },
        tokenA,
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect((await fetch(res.data.fileDownloadUrl)).status).toBe(200);
    });

    it('should replace the attachment set on update and stop serving the removed file', async () => {
      const replacement = await uploadFile(tokenA);

      const res = await gql<{ updateLeave: Leave }>(
        UPDATE_LEAVE,
        { id: leaveId, input: { fileIds: [replacement] } },
        tokenA,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.updateLeave.files.map((file) => file.id)).toEqual([replacement]);
      const removed = await gql(DOWNLOAD_URL, { fileId: attachedFileId }, tokenA);
      expect(codeOf(removed)).toBe(ErrorCode.FILE_NOT_FOUND);
    });
  });

  describe('images', () => {
    let imageLeaveId: string;
    let image: ImageRef;

    it('should store a photo as three WebP sizes without its location data', async () => {
      // 3000x2000 with GPS in EXIF, like a phone photo.
      const photo = await sharp({
        create: { width: 3000, height: 2000, channels: 3, background: { r: 90, g: 140, b: 60 } },
      })
        .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '28/1 36/1 50/1' } })
        .jpeg()
        .toBuffer();
      expect((await sharp(photo).metadata()).exif).toBeDefined();
      const fileId = await uploadFile(tokenA, photo, 'prescription.jpg', 'image/jpeg');

      const res = await gql<{ applyLeave: { id: string; files: ImageRef[] } }>(
        APPLY_LEAVE_WITH_IMAGE,
        {
          input: {
            userId: SEED_IDS.MEMBERSHIP_ADMIN_INST1,
            startDate: '2027-03-01',
            endDate: '2027-03-01',
            type: LeaveType.MEDICAL,
            reason: 'file storage e2e image',
            fileIds: [fileId],
          },
        },
        tokenA,
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      imageLeaveId = res.data.applyLeave.id;
      const [file] = res.data.applyLeave.files;
      assert(file?.url && file.sm && file.md);
      image = file;
      expect(file).toMatchObject({ contentType: 'image/webp', width: 2560, height: 1707 });
      expect(file.placeholder).toMatch(/^data:image\/webp;base64,/);
      const expected = { sm: [128, 85], md: [512, 341], full: [2560, 1707] } as const;
      for (const [size, url] of [
        ['sm', file.sm],
        ['md', file.md],
        ['full', file.url],
      ] as const) {
        const response = await fetch(url);
        expect(response.status, size).toBe(200);
        expect(response.headers.get('cache-control'), size).toBe(
          'private, max-age=43200, immutable',
        );
        const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
        expect(meta.format, size).toBe('webp');
        expect([meta.width, meta.height], size).toEqual(expected[size]);
        expect(meta.exif, size).toBeUndefined();
      }
    });

    it('should keep the thumbnail link of a document scan short-lived', async () => {
      const res = await gql<{ leave: { files: { id: string; sm: string }[] } }>(
        LEAVE_IMAGE_LINKS,
        { id: imageLeaveId },
        tokenA,
      );

      expect(res.errors).toBeUndefined();
      const link = res.data?.leave.files[0]?.sm;
      assert(link && image.sm);
      // Ten minutes, like any other private link: scans are not given cacheable links.
      expect(new URL(link).searchParams.get('X-Amz-Expires')).toBe('600');
    });

    it('should refuse a file that claims to be a JPEG and is not an image', async () => {
      const fake = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.from('not image data at all'),
      ]);
      const fileId = await uploadFile(tokenA, fake, 'fake.jpg', 'image/jpeg');

      const res = await applyLeave(tokenA, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2027-03-02', [fileId]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_IMAGE_INVALID);
    });
  });

  describe('refusals by storage', () => {
    it('should refuse a body larger than the declared size', async () => {
      const res = await requestUpload(tokenA, { sizeBytes: 100 });
      const ticket = res.data?.requestFileUpload;
      assert(ticket);

      expect(await put(ticket, PDF)).toBe(403);
    });

    it('should refuse an upload sent with another content type', async () => {
      const res = await requestUpload(tokenA);
      const ticket = res.data?.requestFileUpload;
      assert(ticket);

      const status = (
        await fetch(ticket.uploadUrl, {
          method: 'PUT',
          body: PDF,
          headers: { 'Content-Type': 'text/html' },
        })
      ).status;

      expect(status).toBe(403);
    });
  });

  describe('refusals by the gateway', () => {
    it('should refuse a type the purpose does not allow', async () => {
      const res = await requestUpload(tokenA, {
        fileName: 'tool.exe',
        contentType: 'application/x-msdownload',
      });

      expect(codeOf(res)).toBe(ErrorCode.FILE_TYPE_NOT_ALLOWED);
    });

    it('should refuse a file over the size limit', async () => {
      const res = await requestUpload(tokenA, { sizeBytes: 10 * 1024 * 1024 + 1 });

      expect(codeOf(res)).toBe(ErrorCode.FILE_TOO_LARGE);
    });

    it('should refuse to attach a file whose bytes are not the declared type', async () => {
      const fileId = await uploadFile(tokenA, NOT_A_PDF);

      const res = await applyLeave(tokenA, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2027-01-12', [fileId]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_CONTENT_MISMATCH);
    });

    it('should refuse to attach a file that was requested but never uploaded', async () => {
      const ticket = (await requestUpload(tokenA)).data?.requestFileUpload;
      assert(ticket);

      const res = await applyLeave(tokenA, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2027-01-13', [
        ticket.fileId,
      ]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_CONTENT_MISMATCH);
    });

    it('should refuse to attach one file to a second leave', async () => {
      const fileId = await uploadFile(tokenA);
      const first = await applyLeave(tokenA, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2027-01-14', [
        fileId,
      ]);
      expect(first.errors).toBeUndefined();

      const second = await applyLeave(tokenA, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2027-01-15', [
        fileId,
      ]);

      expect(codeOf(second)).toBe(ErrorCode.FILE_NOT_FOUND);
    });
  });

  describe('auth and tenant isolation', () => {
    it('should refuse an unauthenticated upload request', async () => {
      const res = await gql(REQUEST_UPLOAD, {
        input: {
          purpose: FilePurpose.LEAVE_ATTACHMENT,
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          sizeBytes: 10,
        },
      });

      expect(codeOf(res)).toBe(ErrorCode.UNAUTHENTICATED);
    });

    it('should refuse a platform token on the institute upload mutation', async () => {
      const { accessToken } = await loginAsPlatformAdmin();

      const res = await requestUpload(accessToken);

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    });

    it("should not show or serve another person's leave attachment to a student", async () => {
      const fileId = await uploadFile(tokenA);
      const attached = await applyLeave(tokenA, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2027-01-19', [
        fileId,
      ]);
      expect(attached.errors).toBeUndefined();
      assert(attached.data);
      const { accessToken: studentToken } = await loginAsStudent();

      const read = await gql<{ leave: Leave }>(
        LEAVE,
        { id: attached.data.applyLeave.id },
        studentToken,
      );
      const download = await gql(DOWNLOAD_URL, { fileId }, studentToken);

      // Whether the leave itself is readable is a leave rule; its documents must not be.
      expect(read.data?.leave?.files ?? []).toEqual([]);
      expect(codeOf(download)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it("should not let another institute attach this institute's pending upload", async () => {
      const fileId = await uploadFile(tokenA);

      const res = await applyLeave(tokenB, SEED_IDS.MEMBERSHIP_ADMIN_INST2, '2027-01-16', [fileId]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it("should not give another institute a download URL for this institute's file", async () => {
      const fileId = await uploadFile(tokenA);
      const attached = await applyLeave(tokenA, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2027-01-17', [
        fileId,
      ]);
      expect(attached.errors).toBeUndefined();

      const res = await gql(DOWNLOAD_URL, { fileId }, tokenB);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });
  });
});
