/**
 * Certificate domain E2E tests — migrated from e2e/api-gateway-e2e/hurl/certificate/*.hurl
 *
 * The e2e api-gateway runs the TCIssuanceWorkflow worker (`TC_ISSUANCE_WORKER_ENABLED`,
 * ROV-232), so a requested TC moves through clearance to GENERATED on its own.
 *
 *   01-request-tc             — requestTC returns a TC row in REQUESTED status
 *   02-tc-clearance           — the worker clears every department and snapshots tc_data
 *   03-tc-approve             — approveTC: GENERATED → APPROVED
 *   04-tc-issue               — issueTC: APPROVED → ISSUED, student → TRANSFERRED_OUT
 *   05-duplicate-tc           — requestDuplicateTC on the ISSUED TC, then issue it as <serial>-D1
 *   07-tc-blocks-non-admin    — teacher token on requestTC → FORBIDDEN
 *
 * Plus: rejectTC (→ CANCELLED) and listTCs with a `status` filter.
 *
 * Skipped:
 *   06-bonafide-certificate   — requires a certificate_templates row, but no
 *                               templates are seeded and there is no public
 *                               mutation to create one
 *
 * The lifecycle flow issues a TC for a student it creates itself, so seeded students stay
 * ENROLLED for the other specs.
 */
import assert from 'node:assert';
import { AcademicStatus, ErrorCode, Gender, TcStatus } from '@roviq/common-types';
import type { SectionModel, StandardModel, StudentModel } from '@roviq/graphql/generated';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SEED } from '../../shared/seed-fixtures';
import { loginAsInstituteAdmin, loginAsTeacher } from './helpers/auth';
import { gql } from './helpers/gql-client';

interface TCNode {
  id: string;
  status: TcStatus;
  reason: string;
  tcSerialNumber: string;
  studentProfileId: string;
  isDuplicate: boolean;
  originalTcId: string | null;
  verificationUrl: string | null;
  pdf: { id: string; url: string | null } | null;
}

const REQUEST_TC = /* GraphQL */ `
  mutation RequestTC($input: RequestTCInput!) {
    requestTC(input: $input) {
      id
      status
      reason
      tcSerialNumber
      studentProfileId
      isDuplicate
      originalTcId
      verificationUrl
      pdf {
        id
        url
      }
    }
  }
`;

interface TCDetails {
  id: string;
  status: TcStatus;
  clearances: Array<{ department: string; cleared: boolean }> | null;
  tcData: Record<string, unknown> | null;
}

/** The workflow runs a handful of short activities; leave room for a cold worker. */
const WORKFLOW_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

const GET_TC = /* GraphQL */ `
  query GetTCDetails($id: ID!) {
    getTCDetails(id: $id) {
      id
      status
      clearances {
        department
        cleared
      }
      tcData
    }
  }
`;

const APPROVE_TC = /* GraphQL */ `
  mutation ApproveTC($id: ID!) {
    approveTC(id: $id) {
      id
      status
    }
  }
`;

const ISSUE_TC = /* GraphQL */ `
  mutation IssueTC($id: ID!) {
    issueTC(id: $id) {
      id
      status
      reason
      tcSerialNumber
      studentProfileId
      isDuplicate
      originalTcId
      verificationUrl
      pdf {
        id
        url
      }
    }
  }
`;

const REQUEST_DUPLICATE_TC = /* GraphQL */ `
  mutation RequestDuplicateTC($input: RequestDuplicateTCInput!) {
    requestDuplicateTC(input: $input) {
      id
      status
      reason
      tcSerialNumber
      studentProfileId
      isDuplicate
      originalTcId
      verificationUrl
      pdf {
        id
        url
      }
    }
  }
`;

const REJECT_TC = /* GraphQL */ `
  mutation RejectTC($id: ID!, $reason: String!) {
    rejectTC(id: $id, reason: $reason) {
      id
      status
    }
  }
`;

const LIST_TCS = /* GraphQL */ `
  query ListTCs($filter: ListTCFilterInput) {
    listTCs(filter: $filter) {
      id
      status
      studentProfileId
    }
  }
`;

describe('Certificate E2E', () => {
  let adminToken: string;
  let teacherToken: string;
  const studentProfileId = SEED.STUDENT_PROFILE_1.id;
  const academicYearId = SEED.ACADEMIC_YEAR_INST1.id;

  beforeAll(async () => {
    adminToken = (await loginAsInstituteAdmin()).accessToken;
    teacherToken = (await loginAsTeacher()).accessToken;
  });

  // ─────────────────────────────────────────────────────
  // 01-request-tc
  // ─────────────────────────────────────────────────────
  describe('requestTC', () => {
    it('creates a tc_register row in REQUESTED status for an enrolled student', async () => {
      const res = await gql<{ requestTC: TCNode }>(
        REQUEST_TC,
        {
          input: {
            studentProfileId,
            academicYearId,
            reason: 'Transfer to another city',
          },
        },
        adminToken,
      );
      expect(res.errors).toBeUndefined();
      const tc = res.data?.requestTC;
      assert(tc);
      expect(tc.id).toBeTruthy();
      expect(tc.status).toBe(TcStatus.REQUESTED);
      expect(tc.reason).toBe('Transfer to another city');
      // Serial is a "TC-REQ-<ts>" placeholder until the issuance step allocates
      // the tenant-sequence number; must be non-empty.
      expect(tc.tcSerialNumber).toBeTruthy();
      expect(tc.studentProfileId).toBe(studentProfileId);
      expect(tc.isDuplicate).toBe(false);
      expect(tc.originalTcId).toBeNull();
      expect(tc.pdf).toBeNull();
      expect(tc.verificationUrl).toBeNull();

      // One request in progress per student: a second is refused until this one is closed.
      const second = await gql<{ requestTC: TCNode }>(
        REQUEST_TC,
        { input: { studentProfileId, academicYearId, reason: 'Transfer to another city' } },
        adminToken,
      );
      expect(second.errors?.[0]?.extensions?.code).toBe(ErrorCode.TC_ALREADY_REQUESTED);

      const closed = await gql<{ rejectTC: { id: string; status: TcStatus } }>(
        REJECT_TC,
        { id: tc.id, reason: 'Closing the test request' },
        adminToken,
      );
      expect(closed.data?.rejectTC.status).toBe(TcStatus.CANCELLED);
    });
  });

  // ─────────────────────────────────────────────────────
  // Reject path — not a Hurl file.
  // ─────────────────────────────────────────────────────
  describe('rejectTC', () => {
    it('transitions a REQUESTED TC to CANCELLED (schema has no REJECTED terminal)', async () => {
      const created = await gql<{ requestTC: TCNode }>(
        REQUEST_TC,
        {
          input: {
            studentProfileId,
            academicYearId,
            reason: 'About to be rejected',
          },
        },
        adminToken,
      );
      expect(created.errors).toBeUndefined();
      const tcId = created.data?.requestTC.id;
      assert(tcId);

      const rejected = await gql<{ rejectTC: { id: string; status: TcStatus } }>(
        REJECT_TC,
        { id: tcId, reason: 'Insufficient documentation' },
        adminToken,
      );
      expect(rejected.errors).toBeUndefined();
      expect(rejected.data?.rejectTC.id).toBe(tcId);
      expect(rejected.data?.rejectTC.status).toBe(TcStatus.CANCELLED);
    });
  });

  // ─────────────────────────────────────────────────────
  // listTCs — verify tenant scoping + status filter
  // ─────────────────────────────────────────────────────
  describe('listTCs', () => {
    it('returns the tenant TCs and supports status filter', async () => {
      const all = await gql<{ listTCs: Array<{ id: string; status: TcStatus }> }>(
        LIST_TCS,
        {},
        adminToken,
      );
      expect(all.errors).toBeUndefined();
      assert(all.data);
      expect(Array.isArray(all.data.listTCs)).toBe(true);
      // Must contain at least the TCs we created above.
      expect(all.data.listTCs.length).toBeGreaterThan(0);

      const cancelled = await gql<{ listTCs: Array<{ id: string; status: TcStatus }> }>(
        LIST_TCS,
        { filter: { status: TcStatus.CANCELLED } },
        adminToken,
      );
      expect(cancelled.errors).toBeUndefined();
      assert(cancelled.data);
      for (const row of cancelled.data.listTCs) {
        expect(row.status).toBe(TcStatus.CANCELLED);
      }
    });
  });

  // ─────────────────────────────────────────────────────
  // 07-tc-blocks-non-admin
  // ─────────────────────────────────────────────────────
  describe('CASL enforcement', () => {
    it('rejects requestTC from a teacher token with FORBIDDEN', async () => {
      const res = await gql<{ requestTC: TCNode }>(
        REQUEST_TC,
        {
          input: {
            studentProfileId,
            academicYearId,
            reason: 'Unauthorized attempt',
          },
        },
        teacherToken,
      );
      expect(res.errors).toBeDefined();
      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });

  // ─────────────────────────────────────────────────────
  // 02-tc-clearance → 03-tc-approve → 04-tc-issue → 05-duplicate-tc
  // ─────────────────────────────────────────────────────
  describe('TC lifecycle through the TCIssuanceWorkflow worker', () => {
    async function createStudentInFirstSection(): Promise<string> {
      const standardsRes = await gql<{ standards: Pick<StandardModel, 'id'>[] }>(
        `query Standards($academicYearId: ID!) { standards(academicYearId: $academicYearId) { id } }`,
        { academicYearId },
        adminToken,
      );
      expect(standardsRes.errors).toBeUndefined();
      const standardId = standardsRes.data?.standards[0]?.id;
      assert(standardId);

      const sectionsRes = await gql<{ sections: Pick<SectionModel, 'id'>[] }>(
        `query Sections($standardId: ID!) { sections(standardId: $standardId) { id } }`,
        { standardId },
        adminToken,
      );
      expect(sectionsRes.errors).toBeUndefined();
      const sectionId = sectionsRes.data?.sections[0]?.id;
      assert(sectionId);

      const studentRes = await gql<{ createStudent: Pick<StudentModel, 'id'> }>(
        `mutation CreateStudent($input: CreateStudentInput!) { createStudent(input: $input) { id } }`,
        {
          input: {
            firstName: { en: 'Tc Lifecycle' },
            gender: Gender.FEMALE,
            standardId,
            sectionId,
            academicYearId,
          },
        },
        adminToken,
      );
      expect(studentRes.errors).toBeUndefined();
      const id = studentRes.data?.createStudent.id;
      assert(id);
      return id;
    }

    it('clears, generates, approves, issues and duplicates a TC', async () => {
      const lifecycleStudentId = await createStudentInFirstSection();

      const requested = await gql<{ requestTC: TCNode }>(
        REQUEST_TC,
        {
          input: {
            studentProfileId: lifecycleStudentId,
            academicYearId,
            reason: 'Family relocated to another city',
          },
        },
        adminToken,
      );
      expect(requested.errors).toBeUndefined();
      const tcId = requested.data?.requestTC.id;
      assert(tcId);
      expect(requested.data?.requestTC.status).toBe(TcStatus.REQUESTED);

      // 02 — the worker clears every department and snapshots the CBSE fields.
      const generated = await vi.waitFor(
        async () => {
          const res = await gql<{ getTCDetails: TCDetails }>(GET_TC, { id: tcId }, adminToken);
          expect(res.errors).toBeUndefined();
          const tc = res.data?.getTCDetails;
          assert(tc);
          expect(tc.status).toBe(TcStatus.GENERATED);
          return tc;
        },
        { timeout: WORKFLOW_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
      );
      const clearances = generated.clearances ?? [];
      expect(clearances.map((c) => c.department).sort()).toEqual([
        'accounts',
        'lab',
        'library',
        'transport',
      ]);
      for (const clearance of clearances) expect(clearance.cleared).toBe(true);
      assert(generated.tcData);
      expect(generated.tcData.studentName).toBe('Tc Lifecycle');
      expect(generated.tcData.reasonForLeaving).toBe('Family relocated to another city');
      expect(generated.tcData.feesPaidUpTo).toBe('Yes');
      // The class by name, not the standard's id.
      expect(generated.tcData.classLastStudied).toBeTruthy();
      expect(generated.tcData.classLastStudied).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);

      // 03 — principal approval.
      const approved = await gql<{ approveTC: TCNode }>(APPROVE_TC, { id: tcId }, adminToken);
      expect(approved.errors).toBeUndefined();
      expect(approved.data?.approveTC.status).toBe(TcStatus.APPROVED);

      // 04 — issuance allocates the real serial and transfers the student out.
      const issued = await gql<{ issueTC: TCNode }>(ISSUE_TC, { id: tcId }, adminToken);
      expect(issued.errors).toBeUndefined();
      const issuedTc = issued.data?.issueTC;
      assert(issuedTc);
      expect(issuedTc.status).toBe(TcStatus.ISSUED);

      // The PDF is a sensitive file: no URL on the reference, a 60-second link on request.
      assert(issuedTc.pdf);
      expect(issuedTc.pdf.url).toBeNull();
      const download = await gql<{ fileDownloadUrl: string }>(
        'mutation ($id: ID!) { fileDownloadUrl(fileId: $id) }',
        { id: issuedTc.pdf.id },
        adminToken,
      );
      expect(download.errors).toBeUndefined();
      assert(download.data);
      const pdf = Buffer.from(await (await fetch(download.data.fileDownloadUrl)).arrayBuffer());
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

      // Anyone holding the printed TC can check it without signing in.
      const token = issuedTc.verificationUrl?.split('/').pop();
      assert(token);
      const verified = await gql<{ verifyTC: { serialNumber: string; isValid: boolean } | null }>(
        'query ($token: String!) { verifyTC(token: $token) { serialNumber isValid } }',
        { token },
      );
      expect(verified.errors).toBeUndefined();
      expect(verified.data?.verifyTC).toEqual({
        serialNumber: issuedTc.tcSerialNumber,
        isValid: true,
      });
      expect(issuedTc.tcSerialNumber).not.toBe(requested.data?.requestTC.tcSerialNumber);
      expect(issuedTc.tcSerialNumber.startsWith('TC-REQ-')).toBe(false);

      const student = await gql<{ getStudent: Pick<StudentModel, 'id' | 'academicStatus'> }>(
        `query GetStudent($id: ID!) { getStudent(id: $id) { id academicStatus } }`,
        { id: lifecycleStudentId },
        adminToken,
      );
      expect(student.errors).toBeUndefined();
      expect(student.data?.getStudent.academicStatus).toBe(AcademicStatus.TRANSFERRED_OUT);

      // A transferred-out student cannot get a second TC.
      const again = await gql<{ requestTC: TCNode }>(
        REQUEST_TC,
        {
          input: {
            studentProfileId: lifecycleStudentId,
            academicYearId,
            reason: 'Asking for a second TC',
          },
        },
        adminToken,
      );
      expect(again.errors?.[0]?.extensions?.code).toBe(ErrorCode.STUDENT_NOT_ENROLLED);

      // 05 — a duplicate of the issued TC.
      const duplicate = await gql<{ requestDuplicateTC: TCNode }>(
        REQUEST_DUPLICATE_TC,
        { input: { originalTcId: tcId, reason: 'Original lost — FIR 123/2026' } },
        adminToken,
      );
      expect(duplicate.errors).toBeUndefined();
      const dup = duplicate.data?.requestDuplicateTC;
      assert(dup);
      expect(dup.status).toBe(TcStatus.DUPLICATE_REQUESTED);
      expect(dup.isDuplicate).toBe(true);
      expect(dup.originalTcId).toBe(tcId);
      expect(dup.studentProfileId).toBe(lifecycleStudentId);

      // 06 — issuing the duplicate numbers it after the original and leaves the student alone.
      const dupIssued = await gql<{ issueTC: TCNode }>(ISSUE_TC, { id: dup.id }, adminToken);
      expect(dupIssued.errors).toBeUndefined();
      expect(dupIssued.data?.issueTC.status).toBe(TcStatus.DUPLICATE_ISSUED);
      expect(dupIssued.data?.issueTC.tcSerialNumber).toBe(`${issuedTc.tcSerialNumber}-D1`);

      const duplicates = await gql<{ listTCs: Array<{ id: string; status: TcStatus }> }>(
        LIST_TCS,
        { filter: { originalTcId: tcId } },
        adminToken,
      );
      expect(duplicates.errors).toBeUndefined();
      expect(duplicates.data?.listTCs.map((tc) => tc.id)).toEqual([dup.id]);
    });

    it('refuses issueTC for a TC that has not been approved', async () => {
      const lifecycleStudentId = await createStudentInFirstSection();
      const requested = await gql<{ requestTC: TCNode }>(
        REQUEST_TC,
        {
          input: {
            studentProfileId: lifecycleStudentId,
            academicYearId,
            reason: 'Issue before approval',
          },
        },
        adminToken,
      );
      expect(requested.errors).toBeUndefined();
      const tcId = requested.data?.requestTC.id;
      assert(tcId);

      const issued = await gql<{ issueTC: TCNode }>(ISSUE_TC, { id: tcId }, adminToken);
      expect(issued.errors?.[0]?.extensions?.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
      expect(issued.data?.issueTC ?? null).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────
  // 06-bonafide-certificate — requires a certificate_templates
  // row. No templates are seeded today and there is no public
  // mutation to create one at test time, so the flow is
  // unreachable from an external client.
  // ─────────────────────────────────────────────────────
  describe.skip('Bonafide certificate (ROV-370 — no way to create a certificate template)', () => {
    it('requests + issues a bonafide certificate from a template', () => {
      // Unskip once either (a) templates are seeded with stable IDs in
      // scripts/seed.ts + e2e/shared/seed.ts, or (b) a createCertificateTemplate
      // mutation is added to the institute scope.
    });
  });
});
