/**
 * Admission application documents through the real stack: pages are uploaded as files, a
 * document is saved from their ids, lists carry no link, and each download goes through the
 * audited call and is checked against the application the page belongs to.
 *
 * RLS on document pages as each database role: `files-rls.integration.spec.ts`. The Aadhaar
 * field rule on downloads: `file.service.spec.ts`.
 */
import assert from 'node:assert';
import { ErrorCode, FilePurpose, UserDocumentType } from '@roviq/common-types';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
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
interface FileRef {
  id: string;
  name: string;
  contentType: string;
  url: string | null;
}
interface ApplicationDocument {
  id: string;
  applicationId: string;
  type: string;
  files: FileRef[];
}
interface UploadFile {
  name: string;
  type: string;
  body: Buffer;
}

const REQUEST_UPLOAD = `mutation RequestUpload($input: RequestFileUploadInput!) {
  requestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
}`;
const ADD_DOCUMENT = `mutation AddDocument($input: AddApplicationDocumentInput!) {
  addApplicationDocument(input: $input) {
    id applicationId type files { id name contentType url }
  }
}`;
const LIST_DOCUMENTS = `query Documents($id: ID!) {
  listApplicationDocuments(applicationId: $id) {
    id applicationId type files { id name contentType url }
  }
}`;
const REMOVE_DOCUMENT = `mutation Remove($id: ID!) { removeApplicationDocument(id: $id) }`;
const DOWNLOAD_URL = `mutation Download($fileId: ID!) { fileDownloadUrl(fileId: $fileId) }`;
const CREATE_APPLICATION = `mutation CreateApp($input: CreateApplicationInput!) {
  createApplication(input: $input) { id }
}`;
const REJECT_APPLICATION = `mutation Reject($id: ID!) { rejectApplication(id: $id) { id status } }`;

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

describe('Application documents E2E', () => {
  let tokenA: string;
  let tenantA: string;
  let tokenB: string;
  let standardId: string;
  let applicationId: string;
  let scan: Buffer;

  function requestUpload(token: string | undefined, file: UploadFile) {
    return gql<{ requestFileUpload: Ticket }>(
      REQUEST_UPLOAD,
      {
        input: {
          purpose: FilePurpose.APPLICATION_DOCUMENT,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.body.length,
        },
      },
      token,
    );
  }

  async function upload(token: string, file: UploadFile): Promise<string> {
    const res = await requestUpload(token, file);
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

  const pdf = (): UploadFile => ({
    name: 'birth-certificate.pdf',
    type: 'application/pdf',
    body: PDF,
  });
  const photo = (): UploadFile => ({ name: 'page-2.jpg', type: 'image/jpeg', body: scan });

  async function createApplication(studentName: string): Promise<string> {
    const res = await gql<{ createApplication: { id: string } }>(
      CREATE_APPLICATION,
      {
        input: {
          academicYearId: SEED.ACADEMIC_YEAR_INST1.id,
          standardId,
          formData: { studentName, parentPhone: '9876543210' },
        },
      },
      tokenA,
    );
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.createApplication.id;
  }

  function addDocument(token: string | undefined, target: string, fileIds: string[]) {
    return gql<{ addApplicationDocument: ApplicationDocument }>(
      ADD_DOCUMENT,
      {
        input: { applicationId: target, type: UserDocumentType.BIRTH_CERTIFICATE, fileIds },
      },
      token,
    );
  }

  function listDocuments(token: string, target: string) {
    return gql<{ listApplicationDocuments: ApplicationDocument[] }>(
      LIST_DOCUMENTS,
      { id: target },
      token,
    );
  }

  beforeAll(async () => {
    ({ accessToken: tokenA, tenantId: tenantA } = await loginAsInstituteAdmin());
    ({ accessToken: tokenB } = await loginAsInstituteAdminSecondInstitute());
    const standards = await gql<{ standards: { id: string }[] }>(
      `query Standards($academicYearId: ID!) { standards(academicYearId: $academicYearId) { id } }`,
      { academicYearId: SEED.ACADEMIC_YEAR_INST1.id },
      tokenA,
    );
    assert(standards.data?.standards[0]);
    standardId = standards.data.standards[0].id;
    applicationId = await createApplication('Aarav Verma');
    scan = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: { r: 240, g: 240, b: 230 } },
    })
      .jpeg()
      .toBuffer();
  });

  describe('saving and reading a document', () => {
    let documentId: string;
    let pdfId: string;
    let photoId: string;

    it('should save a document from uploaded pages, in page order and without links', async () => {
      pdfId = await upload(tokenA, pdf());
      photoId = await upload(tokenA, photo());

      const res = await addDocument(tokenA, applicationId, [pdfId, photoId]);

      expect(res.errors).toBeUndefined();
      assert(res.data);
      documentId = res.data.addApplicationDocument.id;
      expect(res.data.addApplicationDocument).toEqual({
        id: documentId,
        applicationId,
        type: UserDocumentType.BIRTH_CERTIFICATE,
        files: [
          { id: pdfId, name: 'birth-certificate.pdf', contentType: 'application/pdf', url: null },
          { id: photoId, name: 'page-2.jpg', contentType: 'image/webp', url: null },
        ],
      });
    });

    it('should list the document with its pages and no link', async () => {
      const res = await listDocuments(tokenA, applicationId);

      expect(res.errors).toBeUndefined();
      expect(res.data?.listApplicationDocuments).toEqual([
        {
          id: documentId,
          applicationId,
          type: UserDocumentType.BIRTH_CERTIFICATE,
          files: [
            { id: pdfId, name: 'birth-certificate.pdf', contentType: 'application/pdf', url: null },
            { id: photoId, name: 'page-2.jpg', contentType: 'image/webp', url: null },
          ],
        },
      ]);
    });

    it('should download the same bytes through a 60-second link', async () => {
      const res = await gql<{ fileDownloadUrl: string }>(DOWNLOAD_URL, { fileId: pdfId }, tokenA);

      expect(res.errors).toBeUndefined();
      const url = res.data?.fileDownloadUrl;
      assert(url);
      expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('60');
      expect(new URL(url).pathname).toContain(`/institutes/${tenantA}/application-document/`);
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

    it('should refuse a page that already belongs to a document', async () => {
      const res = await addDocument(tokenA, applicationId, [pdfId]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should hide the application and its pages from another institute', async () => {
      const list = await listDocuments(tokenB, applicationId);
      const download = await gql(DOWNLOAD_URL, { fileId: pdfId }, tokenB);
      const remove = await gql(REMOVE_DOCUMENT, { id: documentId }, tokenB);

      expect(codeOf(list)).toBe(ErrorCode.APPLICATION_NOT_FOUND);
      expect(codeOf(download)).toBe(ErrorCode.FILE_NOT_FOUND);
      expect(codeOf(remove)).toBe(ErrorCode.NOT_FOUND);
    });

    it('should refuse a teacher, who has no access to applications', async () => {
      const { accessToken } = await loginAsTeacher();

      const list = await listDocuments(accessToken, applicationId);
      const download = await gql(DOWNLOAD_URL, { fileId: pdfId }, accessToken);
      const ticket = await requestUpload(accessToken, pdf());

      expect(codeOf(list)).toBe(ErrorCode.FORBIDDEN);
      expect(codeOf(download)).toBe(ErrorCode.FILE_NOT_FOUND);
      expect(codeOf(ticket)).toBe(ErrorCode.FORBIDDEN);
    });

    it('should remove the document together with its pages', async () => {
      const removed = await gql<{ removeApplicationDocument: boolean }>(
        REMOVE_DOCUMENT,
        { id: documentId },
        tokenA,
      );
      const list = await listDocuments(tokenA, applicationId);
      const download = await gql(DOWNLOAD_URL, { fileId: pdfId }, tokenA);
      const again = await gql(REMOVE_DOCUMENT, { id: documentId }, tokenA);

      expect(removed.errors).toBeUndefined();
      expect(removed.data?.removeApplicationDocument).toBe(true);
      expect(list.data?.listApplicationDocuments).toEqual([]);
      expect(codeOf(download)).toBe(ErrorCode.FILE_NOT_FOUND);
      expect(codeOf(again)).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('refusals', () => {
    it('should refuse a document with no pages', async () => {
      const res = await addDocument(tokenA, applicationId, []);

      expect(codeOf(res)).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('should refuse a page uploaded by another institute', async () => {
      const foreign = await upload(tokenB, pdf());

      const res = await addDocument(tokenA, applicationId, [foreign]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should refuse another institute adding a document to this application', async () => {
      const fileId = await upload(tokenB, pdf());

      const res = await addDocument(tokenB, applicationId, [fileId]);

      expect(codeOf(res)).toBe(ErrorCode.APPLICATION_NOT_FOUND);
    });

    it('should refuse a file whose content is not what it claims', async () => {
      const fileId = await upload(tokenA, {
        name: 'fake.pdf',
        type: 'application/pdf',
        body: Buffer.from('MZ not a pdf'),
      });

      const res = await addDocument(tokenA, applicationId, [fileId]);

      expect(codeOf(res)).toBe(ErrorCode.FILE_CONTENT_MISMATCH);
    });

    it('should refuse an unauthenticated request', async () => {
      const res = await addDocument(undefined, applicationId, [applicationId]);

      expect(codeOf(res)).toBe(ErrorCode.UNAUTHENTICATED);
    });
  });

  describe('a closed application', () => {
    let closedId: string;
    let documentId: string;
    let fileId: string;

    beforeAll(async () => {
      closedId = await createApplication('Diya Nair');
      fileId = await upload(tokenA, pdf());
      const added = await addDocument(tokenA, closedId, [fileId]);
      assert(added.data);
      documentId = added.data.addApplicationDocument.id;
      const rejected = await gql(REJECT_APPLICATION, { id: closedId }, tokenA);
      expect(rejected.errors).toBeUndefined();
    });

    it('should refuse a new document', async () => {
      const page = await upload(tokenA, pdf());

      const res = await addDocument(tokenA, closedId, [page]);

      expect(codeOf(res)).toBe(ErrorCode.APPLICATION_CLOSED);
    });

    it('should refuse removing a document and keep it downloadable', async () => {
      const remove = await gql(REMOVE_DOCUMENT, { id: documentId }, tokenA);
      const download = await gql<{ fileDownloadUrl: string }>(DOWNLOAD_URL, { fileId }, tokenA);

      expect(codeOf(remove)).toBe(ErrorCode.APPLICATION_CLOSED);
      expect(download.errors).toBeUndefined();
    });
  });
});
