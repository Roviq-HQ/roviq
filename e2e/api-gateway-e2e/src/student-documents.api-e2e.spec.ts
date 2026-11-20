/**
 * Student documents through the real stack: pages are uploaded as files, a document is saved
 * from their ids, lists carry no link, each download goes through the audited call, and a
 * removed document stops being listed or downloadable.
 *
 * RLS on document pages as each database role: `files-rls.integration.spec.ts`. The Aadhaar
 * field rule on downloads: `file.service.spec.ts`.
 */
import assert from 'node:assert';
import { ErrorCode, FilePurpose, UserDocumentType } from '@roviq/common-types';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../shared/seed-fixtures';
import {
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsPlatformAdmin,
  loginAsStudent,
  loginAsTeacher,
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
  url: string | null;
}
interface StudentDocument {
  id: string;
  type: string;
  referenceNumber: string | null;
  files: FileRef[];
}

const REQUEST_UPLOAD = `mutation RequestUpload($input: RequestFileUploadInput!) {
  requestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
}`;
const UPLOAD_DOCUMENT = `mutation UploadDocument($input: UploadStudentDocumentInput!) {
  uploadStudentDocument(input: $input) {
    id type referenceNumber files { id name contentType url }
  }
}`;
const LIST_DOCUMENTS = `query Documents($id: ID!) {
  listStudentDocuments(studentProfileId: $id) {
    id type referenceNumber files { id name contentType url }
  }
}`;
const DOWNLOAD_URL = `mutation Download($fileId: ID!) { fileDownloadUrl(fileId: $fileId) }`;
const DELETE_DOCUMENT = `mutation DeleteDocument($id: ID!) { deleteStudentDocument(id: $id) }`;
const ADMIN_USER_DOCUMENTS = `query AdminUser($userId: ID!) {
  adminGetUser(userId: $userId) { documents { id files { id name url } } }
}`;
const ADMIN_DOWNLOAD_URL = `mutation AdminDownload($fileId: ID!) {
  adminUserDocumentDownloadUrl(fileId: $fileId)
}`;

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

describe('Student documents E2E', () => {
  let tokenA: string;
  let tokenB: string;
  let scan: Buffer;

  function requestUpload(
    token: string | undefined,
    file: { name: string; type: string; body: Buffer },
    subjectUserId: string,
  ) {
    return gql<{ requestFileUpload: Ticket }>(
      REQUEST_UPLOAD,
      {
        input: {
          purpose: FilePurpose.USER_DOCUMENT,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.body.length,
          subjectUserId,
        },
      },
      token,
    );
  }

  async function upload(
    token: string,
    file: { name: string; type: string; body: Buffer },
    subjectUserId: string = SEED_IDS.USER_STUDENT,
  ): Promise<string> {
    const res = await requestUpload(token, file, subjectUserId);
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

  const pdf = () => ({ name: 'birth-certificate.pdf', type: 'application/pdf', body: PDF });
  const photo = () => ({ name: 'page-2.jpg', type: 'image/jpeg', body: scan });

  function saveDocument(token: string | undefined, fileIds: string[], referenceNumber?: string) {
    return gql<{ uploadStudentDocument: StudentDocument }>(
      UPLOAD_DOCUMENT,
      {
        input: {
          studentProfileId: SEED_IDS.STUDENT_PROFILE_1,
          type: UserDocumentType.BIRTH_CERTIFICATE,
          fileIds,
          referenceNumber,
        },
      },
      token,
    );
  }

  beforeAll(async () => {
    ({ accessToken: tokenA } = await loginAsInstituteAdmin());
    ({ accessToken: tokenB } = await loginAsInstituteAdminSecondInstitute());
    scan = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: { r: 240, g: 240, b: 230 } },
    })
      .jpeg()
      .toBuffer();
  });

  describe('saving and reading a document', () => {
    const reference = `BC-${Date.now()}`;
    let pdfId: string;
    let photoId: string;

    it('should save a document from uploaded pages, in page order and without links', async () => {
      pdfId = await upload(tokenA, pdf());
      photoId = await upload(tokenA, photo());

      const res = await saveDocument(tokenA, [pdfId, photoId], reference);

      expect(res.errors).toBeUndefined();
      expect(res.data?.uploadStudentDocument.files).toEqual([
        { id: pdfId, name: 'birth-certificate.pdf', contentType: 'application/pdf', url: null },
        { id: photoId, name: 'page-2.jpg', contentType: 'image/webp', url: null },
      ]);
    });

    it('should list the document with its pages and no link', async () => {
      const res = await gql<{ listStudentDocuments: StudentDocument[] }>(
        LIST_DOCUMENTS,
        { id: SEED_IDS.STUDENT_PROFILE_1 },
        tokenA,
      );

      expect(res.errors).toBeUndefined();
      const saved = res.data?.listStudentDocuments.find((d) => d.referenceNumber === reference);
      assert(saved);
      expect(saved.files.map((f) => [f.id, f.url])).toEqual([
        [pdfId, null],
        [photoId, null],
      ]);
    });

    it('should download the same bytes through a 60-second link', async () => {
      const res = await gql<{ fileDownloadUrl: string }>(DOWNLOAD_URL, { fileId: pdfId }, tokenA);

      expect(res.errors).toBeUndefined();
      const url = res.data?.fileDownloadUrl;
      assert(url);
      expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('60');
      expect(new URL(url).pathname).toContain(`/users/${SEED_IDS.USER_STUDENT}/user-document/`);
      const body = Buffer.from(await (await fetch(url)).arrayBuffer());
      expect(body.equals(PDF)).toBe(true);
    });

    it('should serve a scanned page as a re-encoded image', async () => {
      const res = await gql<{ fileDownloadUrl: string }>(DOWNLOAD_URL, { fileId: photoId }, tokenA);

      expect(res.errors).toBeUndefined();
      assert(res.data);
      const page = await sharp(
        Buffer.from(await (await fetch(res.data.fileDownloadUrl)).arrayBuffer()),
      ).metadata();
      expect([page.format, page.width, page.height]).toEqual(['webp', 900, 1200]);
    });

    it('should show the pages to a platform admin and let them download through their own call', async () => {
      const { accessToken: platformToken } = await loginAsPlatformAdmin();

      const user = await gql<{
        adminGetUser: { documents: { id: string; files: { id: string; url: string | null }[] }[] };
      }>(ADMIN_USER_DOCUMENTS, { userId: SEED_IDS.USER_STUDENT }, platformToken);
      const link = await gql<{ adminUserDocumentDownloadUrl: string }>(
        ADMIN_DOWNLOAD_URL,
        { fileId: pdfId },
        platformToken,
      );

      expect(user.errors).toBeUndefined();
      const files = user.data?.adminGetUser.documents.flatMap((d) => d.files) ?? [];
      expect(files).toContainEqual({ id: pdfId, name: 'birth-certificate.pdf', url: null });
      expect(link.errors).toBeUndefined();
      assert(link.data);
      const body = Buffer.from(
        await (await fetch(link.data.adminUserDocumentDownloadUrl)).arrayBuffer(),
      );
      expect(body.equals(PDF)).toBe(true);
    });

    it('should refuse a download from an institute the student does not belong to', async () => {
      const res = await gql(DOWNLOAD_URL, { fileId: pdfId }, tokenB);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should refuse the admin download call to an institute user', async () => {
      const res = await gql(ADMIN_DOWNLOAD_URL, { fileId: pdfId }, tokenA);

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    });

    it('should refuse a page that already belongs to a document', async () => {
      const res = await saveDocument(tokenA, [pdfId]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });
  });

  describe('refusals', () => {
    it('should refuse a document with no pages', async () => {
      const res = await saveDocument(tokenA, []);

      expect(codeOf(res)).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('should refuse a page uploaded for a different person', async () => {
      const forGuardian = await upload(tokenA, pdf(), SEED_IDS.USER_GUARDIAN);

      const res = await saveDocument(tokenA, [forGuardian]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should refuse an upload for a student of another institute', async () => {
      const res = await requestUpload(tokenB, pdf(), SEED_IDS.USER_STUDENT);

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    });

    it('should refuse another institute saving a document for this student', async () => {
      const res = await saveDocument(tokenB, [SEED_IDS.STUDENT_PROFILE_1]);

      expect(codeOf(res)).toBe(ErrorCode.STUDENT_NOT_FOUND);
    });

    it('should refuse a student uploading document pages', async () => {
      const { accessToken } = await loginAsStudent();

      const res = await requestUpload(accessToken, pdf(), SEED_IDS.USER_STUDENT);

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    });

    it('should refuse a file whose content is not what it claims', async () => {
      const fake = { name: 'fake.pdf', type: 'application/pdf', body: Buffer.from('MZ not a pdf') };
      const fileId = await upload(tokenA, fake);

      const res = await saveDocument(tokenA, [fileId]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_CONTENT_MISMATCH);
    });

    it('should refuse an unauthenticated request', async () => {
      const res = await saveDocument(undefined, [SEED_IDS.STUDENT_PROFILE_1]);

      expect(codeOf(res)).toBe(ErrorCode.UNAUTHENTICATED);
    });
  });

  describe('removing a document', () => {
    let documentId: string;
    let pageId: string;

    const listedIds = async (token: string) => {
      const res = await gql<{ listStudentDocuments: StudentDocument[] }>(
        LIST_DOCUMENTS,
        { id: SEED_IDS.STUDENT_PROFILE_1 },
        token,
      );
      expect(res.errors).toBeUndefined();
      return res.data?.listStudentDocuments.map((d) => d.id) ?? [];
    };

    beforeAll(async () => {
      pageId = await upload(tokenA, pdf());
      const saved = await saveDocument(tokenA, [pageId], `RM-${Date.now()}`);
      expect(saved.errors).toBeUndefined();
      assert(saved.data);
      documentId = saved.data.uploadStudentDocument.id;
    });

    it('should refuse a teacher, who may only read students', async () => {
      const { accessToken } = await loginAsTeacher();

      const res = await gql(DELETE_DOCUMENT, { id: documentId }, accessToken);

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
      expect(await listedIds(tokenA)).toContain(documentId);
    });

    it('should answer not found to an institute the student does not belong to', async () => {
      const res = await gql(DELETE_DOCUMENT, { id: documentId }, tokenB);

      expect(codeOf(res)).toBe(ErrorCode.STUDENT_NOT_FOUND);
      expect(await listedIds(tokenA)).toContain(documentId);
    });

    it('should remove the document so it is no longer listed or downloadable', async () => {
      const res = await gql<{ deleteStudentDocument: boolean }>(
        DELETE_DOCUMENT,
        { id: documentId },
        tokenA,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.deleteStudentDocument).toBe(true);
      expect(await listedIds(tokenA)).not.toContain(documentId);
      const download = await gql(DOWNLOAD_URL, { fileId: pageId }, tokenA);
      expect(codeOf(download)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should hide the removed document from the platform admin too', async () => {
      const { accessToken: platformToken } = await loginAsPlatformAdmin();

      const user = await gql<{ adminGetUser: { documents: { id: string }[] } }>(
        ADMIN_USER_DOCUMENTS,
        { userId: SEED_IDS.USER_STUDENT },
        platformToken,
      );
      const link = await gql(ADMIN_DOWNLOAD_URL, { fileId: pageId }, platformToken);

      expect(user.errors).toBeUndefined();
      expect(user.data?.adminGetUser.documents.map((d) => d.id)).not.toContain(documentId);
      expect(codeOf(link)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should answer not found when removing it again', async () => {
      const res = await gql(DELETE_DOCUMENT, { id: documentId }, tokenA);

      expect(codeOf(res)).toBe(ErrorCode.STUDENT_NOT_FOUND);
    });
  });
});
