/**
 * Bulk student import through the real stack, Temporal worker included: the CSV is an
 * uploaded file, the workflow reads it from storage, and the rows it could not import come
 * back as a stored report.
 *
 * Reading and writing files as the workflow's institute: `workflow-file-store.integration.spec.ts`.
 */
import assert from 'node:assert';
import { ErrorCode, FilePurpose } from '@roviq/common-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../shared/seed-fixtures';
import {
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsStudent,
  loginAsTeacher,
} from './helpers/auth';
import { gql } from './helpers/gql-client';

interface Ticket {
  fileId: string;
  uploadUrl: string;
  headers: { name: string; value: string }[];
}
interface Progress {
  status: string;
  totalRows: number;
  created: number;
  skipped: number;
  errors: number;
  report: { name: string; contentType: string; url: string | null } | null;
}

const REQUEST_UPLOAD = `mutation RequestUpload($input: RequestFileUploadInput!) {
  requestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
}`;
const START = `mutation Start($input: BulkCreateStudentsInput!) {
  bulkCreateStudents(input: $input) { workflowId }
}`;
const PROGRESS = `query Progress($id: String!) {
  bulkImportProgress(workflowId: $id) {
    status totalRows created skipped errors report { name contentType url }
  }
}`;
const STANDARDS = `query Standards($ay: ID!) { standards(academicYearId: $ay) { id } }`;
const SECTIONS = `query Sections($s: ID!) { sections(standardId: $s) { id } }`;

const IMPORT_TIMEOUT_MS = 60_000;

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

describe('Bulk student import E2E', () => {
  let tokenA: string;
  let tokenB: string;
  let standardId: string;
  let sectionId: string;

  function requestUpload(token: string, body: Buffer) {
    return gql<{ requestFileUpload: Ticket }>(
      REQUEST_UPLOAD,
      {
        input: {
          purpose: FilePurpose.BULK_IMPORT_CSV,
          fileName: 'students.csv',
          contentType: 'text/csv',
          sizeBytes: body.length,
        },
      },
      token,
    );
  }

  async function uploadCsv(lines: string[]): Promise<string> {
    const body = Buffer.from(lines.join('\n'));
    const res = await requestUpload(tokenA, body);
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

  function start(token: string | undefined, fileId: string) {
    return gql<{ bulkCreateStudents: { workflowId: string } }>(
      START,
      {
        input: {
          fileId,
          academicYearId: SEED_IDS.ACADEMIC_YEAR_INST1,
          standardId,
          sectionId,
          fieldMapping: {},
        },
      },
      token,
    );
  }

  async function waitForCompletion(workflowId: string): Promise<Progress> {
    const deadline = Date.now() + IMPORT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const res = await gql<{ bulkImportProgress: Progress }>(PROGRESS, { id: workflowId }, tokenA);
      expect(res.errors).toBeUndefined();
      const progress = res.data?.bulkImportProgress;
      if (progress?.status === 'COMPLETED' || progress?.status === 'FAILED') return progress;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Import ${workflowId} did not finish within ${IMPORT_TIMEOUT_MS} ms`);
  }

  beforeAll(async () => {
    ({ accessToken: tokenA } = await loginAsInstituteAdmin());
    ({ accessToken: tokenB } = await loginAsInstituteAdminSecondInstitute());
    const standards = await gql<{ standards: { id: string }[] }>(
      STANDARDS,
      { ay: SEED_IDS.ACADEMIC_YEAR_INST1 },
      tokenA,
    );
    const firstStandard = standards.data?.standards[0];
    assert(firstStandard);
    standardId = firstStandard.id;
    const sections = await gql<{ sections: { id: string }[] }>(SECTIONS, { s: standardId }, tokenA);
    const firstSection = sections.data?.sections[0];
    assert(firstSection);
    sectionId = firstSection.id;
  });

  describe('an import with good and bad rows', () => {
    const stamp = Date.now().toString().slice(-7);
    let fileId: string;
    let workflowId: string;
    let finished: Progress;

    it(
      'should create the valid student and count the rows it could not import',
      async () => {
        fileId = await uploadCsv([
          'first_name,last_name,date_of_birth,gender',
          `Imported${stamp},Kumar,15/04/2010,male`,
          `Baddate${stamp},Kumar,not-a-date,female`,
          `Badgender${stamp},Kumar,2010-01-01,xyz`,
        ]);

        const started = await start(tokenA, fileId);
        expect(started.errors).toBeUndefined();
        assert(started.data);
        workflowId = started.data.bulkCreateStudents.workflowId;
        finished = await waitForCompletion(workflowId);

        expect(finished).toMatchObject({
          status: 'COMPLETED',
          totalRows: 3,
          created: 1,
          skipped: 0,
          errors: 2,
        });
      },
      IMPORT_TIMEOUT_MS + 10_000,
    );

    it('should give a downloadable report naming each failed row, with no database error text', async () => {
      assert(finished.report?.url);
      expect(finished.report).toMatchObject({ name: 'import-errors.csv', contentType: 'text/csv' });

      const report = await (await fetch(finished.report.url)).text();

      expect(report).toContain('# Total rows: 3');
      expect(report).toContain('# Created: 1');
      expect(report).toContain('2,date_of_birth,');
      expect(report).toContain('3,gender,');
      expect(report).not.toMatch(/insert into|Failed query/i);
    });

    it("should answer not found when another institute asks for this import's progress", async () => {
      const res = await gql(PROGRESS, { id: workflowId }, tokenB);

      expect(codeOf(res)).toBe(ErrorCode.NOT_FOUND);
    });

    it('should refuse the progress, and so the report, to a teacher who may read students but not create them', async () => {
      const { accessToken } = await loginAsTeacher();

      const res = await gql(PROGRESS, { id: workflowId }, accessToken);

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    });

    it('should refuse to start a second import from the same uploaded file', async () => {
      const res = await start(tokenA, fileId);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });
  });

  describe('refusals', () => {
    it('should refuse a file that is not text', async () => {
      const body = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
      const ticket = (await requestUpload(tokenA, body)).data?.requestFileUpload;
      assert(ticket);
      await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body,
        headers: Object.fromEntries(ticket.headers.map((h) => [h.name, h.value])),
      });

      const res = await start(tokenA, ticket.fileId);

      expect(codeOf(res)).toBe(ErrorCode.FILE_CONTENT_MISMATCH);
    });

    it("should refuse another institute starting an import from this institute's upload", async () => {
      const fileId = await uploadCsv(['first_name,date_of_birth,gender', 'A,2010-01-01,male']);

      const res = await start(tokenB, fileId);

      expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('should refuse a student uploading an import file', async () => {
      const { accessToken } = await loginAsStudent();

      const res = await requestUpload(accessToken, Buffer.from('first_name\nA'));

      expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    });

    it('should refuse an unauthenticated start', async () => {
      const res = await start(undefined, SEED_IDS.STUDENT_PROFILE_1);

      expect(codeOf(res)).toBe(ErrorCode.UNAUTHENTICATED);
    });
  });
});
