/**
 * Certificate scans on staff qualifications through the real stack: upload, attach, replace,
 * remove, and what happens to the stored file each time.
 */
import assert from 'node:assert';
import { ErrorCode, FilePurpose, QualificationType } from '@roviq/common-types';
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
interface Qualification {
  id: string;
  degreeName: string;
  gradePercentage: string | null;
  certificate: { id: string; name: string; contentType: string; url: string | null } | null;
}

const FIELDS = `id degreeName gradePercentage certificate { id name contentType url }`;
const REQUEST_UPLOAD = `mutation RequestUpload($input: RequestFileUploadInput!) {
  requestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
}`;
const CREATE = `mutation Create($input: CreateStaffQualificationInput!) {
  createStaffQualification(input: $input) { ${FIELDS} }
}`;
const UPDATE = `mutation Update($id: ID!, $input: UpdateStaffQualificationInput!) {
  updateStaffQualification(id: $id, input: $input) { ${FIELDS} }
}`;
const DELETE = `mutation Delete($id: ID!) { deleteStaffQualification(id: $id) }`;
const LIST = `query List($id: ID!) { listStaffQualifications(staffProfileId: $id) { ${FIELDS} } }`;
const DOWNLOAD_URL = `mutation Download($fileId: ID!) { fileDownloadUrl(fileId: $fileId) }`;

const pdfBytes = (marker: string) =>
  Buffer.from(
    `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

describe('Staff certificate E2E', () => {
  let tokenA: string;
  let tokenB: string;

  function requestUpload(token: string | undefined, purpose: FilePurpose, body: Buffer) {
    return gql<{ requestFileUpload: Ticket }>(
      REQUEST_UPLOAD,
      {
        input: {
          purpose,
          fileName: 'bed-degree.pdf',
          contentType: 'application/pdf',
          sizeBytes: body.length,
        },
      },
      token,
    );
  }

  async function upload(
    body: Buffer,
    purpose: FilePurpose = FilePurpose.STAFF_CERTIFICATE,
  ): Promise<string> {
    const res = await requestUpload(tokenA, purpose, body);
    expect(res.errors).toBeUndefined();
    const ticket = res.data?.requestFileUpload;
    assert(ticket);
    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      body,
      headers: Object.fromEntries(ticket.headers.map((h) => [h.name, h.value])),
    });
    expect(put.status).toBe(200);
    return ticket.fileId;
  }

  function create(token: string | undefined, certificateFileId?: string) {
    return gql<{ createStaffQualification: Qualification }>(
      CREATE,
      {
        input: {
          staffProfileId: SEED_IDS.STAFF_PROFILE_1,
          type: QualificationType.PROFESSIONAL,
          degreeName: `B.Ed ${Date.now()}`,
          certificateFileId,
        },
      },
      token,
    );
  }

  const update = (id: string, input: Record<string, unknown>) =>
    gql<{ updateStaffQualification: Qualification }>(UPDATE, { id, input }, tokenA);

  async function listed(id: string): Promise<Qualification | undefined> {
    const res = await gql<{ listStaffQualifications: Qualification[] }>(
      LIST,
      { id: SEED_IDS.STAFF_PROFILE_1 },
      tokenA,
    );
    expect(res.errors).toBeUndefined();
    return res.data?.listStaffQualifications.find((q) => q.id === id);
  }

  const downloadCode = async (fileId: string) =>
    codeOf(await gql(DOWNLOAD_URL, { fileId }, tokenA));

  beforeAll(async () => {
    ({ accessToken: tokenA } = await loginAsInstituteAdmin());
    ({ accessToken: tokenB } = await loginAsInstituteAdminSecondInstitute());
  });

  describe('the life of a certificate', () => {
    const first = pdfBytes('first scan');
    const second = pdfBytes('second scan');
    let qualificationId: string;
    let firstFileId: string;
    let secondFileId: string;

    it('should save a qualification with its certificate and serve the same bytes', async () => {
      firstFileId = await upload(first);

      const res = await create(tokenA, firstFileId);

      expect(res.errors).toBeUndefined();
      const saved = res.data?.createStaffQualification;
      assert(saved?.certificate?.url);
      qualificationId = saved.id;
      expect(saved.certificate).toMatchObject({
        id: firstFileId,
        name: 'bed-degree.pdf',
        contentType: 'application/pdf',
      });
      const body = Buffer.from(await (await fetch(saved.certificate.url)).arrayBuffer());
      expect(body.equals(first)).toBe(true);
    });

    it('should keep the certificate when another field is edited', async () => {
      const res = await update(qualificationId, { gradePercentage: '82%' });

      expect(res.errors).toBeUndefined();
      expect(res.data?.updateStaffQualification.gradePercentage).toBe('82%');
      expect((await listed(qualificationId))?.certificate?.id).toBe(firstFileId);
    });

    it('should replace the certificate and delete the old file', async () => {
      secondFileId = await upload(second);

      const res = await update(qualificationId, { certificateFileId: secondFileId });

      expect(res.errors).toBeUndefined();
      expect(res.data?.updateStaffQualification.certificate?.id).toBe(secondFileId);
      expect(await downloadCode(firstFileId)).toBe(ErrorCode.FILE_NOT_FOUND);
      expect(await downloadCode(secondFileId)).toBeUndefined();
    });

    it('should remove the certificate when it is set to null', async () => {
      const res = await update(qualificationId, { certificateFileId: null });

      expect(res.errors).toBeUndefined();
      expect(res.data?.updateStaffQualification.certificate).toBeNull();
      expect(await downloadCode(secondFileId)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should delete the certificate together with its qualification', async () => {
      const fileId = await upload(pdfBytes('third scan'));
      const created = await create(tokenA, fileId);
      const id = created.data?.createStaffQualification.id;
      assert(id);

      const res = await gql(DELETE, { id }, tokenA);

      expect(res.errors).toBeUndefined();
      expect(await listed(id)).toBeUndefined();
      expect(await downloadCode(fileId)).toBe(ErrorCode.FILE_NOT_FOUND);
    });
  });

  describe('refusals', () => {
    it('should refuse a file uploaded for another purpose', async () => {
      const leaveFile = await upload(pdfBytes('leave'), FilePurpose.LEAVE_ATTACHMENT);

      const res = await create(tokenA, leaveFile);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should refuse a certificate already attached to a qualification', async () => {
      const fileId = await upload(pdfBytes('shared'));
      expect((await create(tokenA, fileId)).errors).toBeUndefined();

      const res = await create(tokenA, fileId);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it("should refuse another institute adding a qualification to this institute's staff member", async () => {
      const res = await create(tokenB);

      expect(codeOf(res)).toBe(ErrorCode.STAFF_NOT_FOUND);
    });

    it("should refuse another institute reading this institute's certificate", async () => {
      const fileId = await upload(pdfBytes('private'));
      expect((await create(tokenA, fileId)).errors).toBeUndefined();

      const res = await gql(DOWNLOAD_URL, { fileId }, tokenB);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should refuse a student uploading a certificate', async () => {
      const { accessToken } = await loginAsStudent();

      const res = await requestUpload(accessToken, FilePurpose.STAFF_CERTIFICATE, pdfBytes('x'));

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    });

    it('should refuse an unauthenticated request', async () => {
      const res = await create(undefined);

      expect(codeOf(res)).toBe(ErrorCode.UNAUTHENTICATED);
    });
  });
});
