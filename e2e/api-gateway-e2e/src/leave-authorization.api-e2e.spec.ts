/**
 * Leave reads and writes are limited to the leaves the caller's rules cover (ROV-304):
 * a student files, reads and withdraws (while pending) only their own, a guardian files,
 * reads and withdraws only their linked children's, the decider is always the caller, and
 * an attachment is served only with its leave.
 */
import assert from 'node:assert';
import { ErrorCode, FilePurpose, LeaveStatus, LeaveType } from '@roviq/common-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_IDS } from '../../shared/seed-fixtures';
import {
  loginAsGuardian,
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsMultiChildGuardian,
  loginAsStudent,
  loginAsSubjectTeacher,
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
interface Leave {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: LeaveType;
  reason: string;
  status: LeaveStatus;
  decidedBy: string | null;
  files: FileRef[];
}

const LEAVE_FIELDS = `id userId startDate endDate type reason status decidedBy
  files { id name contentType sizeBytes url }`;

const REQUEST_UPLOAD = `mutation RequestUpload($input: RequestFileUploadInput!) {
  requestFileUpload(input: $input) { fileId uploadUrl headers { name value } }
}`;
const APPLY_LEAVE = `mutation Apply($input: CreateLeaveInput!) {
  applyLeave(input: $input) { ${LEAVE_FIELDS} }
}`;
const LEAVE = `query Leave($id: ID!) { leave(id: $id) { ${LEAVE_FIELDS} } }`;
const LEAVES = `query Leaves { leaves { ${LEAVE_FIELDS} } }`;
const APPROVE_LEAVE = `mutation Approve($id: ID!) { approveLeave(id: $id) { ${LEAVE_FIELDS} } }`;
const REJECT_LEAVE = `mutation Reject($id: ID!) { rejectLeave(id: $id) { ${LEAVE_FIELDS} } }`;
const CANCEL_LEAVE = `mutation Cancel($id: ID!) { cancelLeave(id: $id) { ${LEAVE_FIELDS} } }`;
const DELETE_LEAVE = `mutation Delete($id: ID!) { deleteLeave(id: $id) }`;
const DOWNLOAD_URL = `mutation Download($fileId: ID!) { fileDownloadUrl(fileId: $fileId) }`;

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]);

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

async function put(ticket: Ticket, body: Buffer): Promise<number> {
  const res = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body,
    headers: Object.fromEntries(ticket.headers.map((h) => [h.name, h.value])),
  });
  return res.status;
}

async function uploadFile(token: string): Promise<string> {
  const res = await gql<{ requestFileUpload: Ticket }>(
    REQUEST_UPLOAD,
    {
      input: {
        purpose: FilePurpose.LEAVE_ATTACHMENT,
        fileName: 'medical-certificate.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
      },
    },
    token,
  );
  expect(res.errors).toBeUndefined();
  const ticket = res.data?.requestFileUpload;
  assert(ticket);
  expect(await put(ticket, PDF)).toBe(200);
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
        reason: 'leave authorization e2e',
        fileIds,
      },
    },
    token,
  );
}

async function downloadBytes(token: string, fileId: string): Promise<Buffer> {
  const res = await gql<{ fileDownloadUrl: string }>(DOWNLOAD_URL, { fileId }, token);
  expect(res.errors).toBeUndefined();
  assert(res.data);
  const download = await fetch(res.data.fileDownloadUrl);
  expect(download.status).toBe(200);
  return Buffer.from(await download.arrayBuffer());
}

async function listLeaves(token: string): Promise<Leave[]> {
  const res = await gql<{ leaves: Leave[] }>(LEAVES, {}, token);
  expect(res.errors).toBeUndefined();
  assert(res.data);
  return res.data.leaves;
}

describe('Leave authorization E2E', () => {
  let adminToken: string;
  let studentToken: string;
  let guardianToken: string;
  let studentLeaveId: string;
  let studentFileId: string;
  let adminLeaveId: string;
  let adminFileId: string;
  let guardianLeaveId: string;
  let withdrawnLeaveId: string;

  beforeAll(async () => {
    ({ accessToken: adminToken } = await loginAsInstituteAdmin());
    ({ accessToken: studentToken } = await loginAsStudent());
    ({ accessToken: guardianToken } = await loginAsGuardian());
  });

  afterAll(async () => {
    for (const id of [studentLeaveId, adminLeaveId, guardianLeaveId, withdrawnLeaveId]) {
      if (!id) continue;
      const res = await gql<{ deleteLeave: boolean }>(DELETE_LEAVE, { id }, adminToken);
      expect(res.errors).toBeUndefined();
      expect(res.data?.deleteLeave).toBe(true);
    }
  });

  it('should let a student apply for their own leave with an attachment', async () => {
    studentFileId = await uploadFile(studentToken);

    const res = await applyLeave(studentToken, SEED_IDS.MEMBERSHIP_STUDENT_INST1, '2029-03-05', [
      studentFileId,
    ]);

    expect(res.errors).toBeUndefined();
    const leave = res.data?.applyLeave;
    assert(leave);
    studentLeaveId = leave.id;
    expect(leave.userId).toBe(SEED_IDS.MEMBERSHIP_STUDENT_INST1);
    expect(leave.status).toBe(LeaveStatus.PENDING);
    expect(leave.files.map((file) => file.id)).toEqual([studentFileId]);
  });

  it('should let the student read their leave back and download its attachment', async () => {
    const res = await gql<{ leave: Leave }>(LEAVE, { id: studentLeaveId }, studentToken);

    expect(res.errors).toBeUndefined();
    expect(res.data?.leave.files.map((file) => file.id)).toEqual([studentFileId]);
    expect((await downloadBytes(studentToken, studentFileId)).equals(PDF)).toBe(true);
  });

  it("should list only the student's own leaves to the student", async () => {
    const leaves = await listLeaves(studentToken);

    expect(leaves.map((leave) => leave.id)).toContain(studentLeaveId);
    for (const leave of leaves) {
      expect(leave.userId).toBe(SEED_IDS.MEMBERSHIP_STUDENT_INST1);
    }
  });

  it("should refuse a student's leave application for another membership", async () => {
    const res = await applyLeave(studentToken, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2029-03-07', []);

    expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
  });

  it("should hide another person's leave and its attachment from the student", async () => {
    adminFileId = await uploadFile(adminToken);
    const created = await applyLeave(adminToken, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2029-03-06', [
      adminFileId,
    ]);
    expect(created.errors).toBeUndefined();
    assert(created.data);
    adminLeaveId = created.data.applyLeave.id;

    const read = await gql<{ leave: Leave }>(LEAVE, { id: adminLeaveId }, studentToken);
    const leaves = await listLeaves(studentToken);
    const download = await gql(DOWNLOAD_URL, { fileId: adminFileId }, studentToken);

    expect(codeOf(read)).toBe(ErrorCode.LEAVE_NOT_FOUND);
    expect(leaves.map((leave) => leave.id)).not.toContain(adminLeaveId);
    expect(codeOf(download)).toBe(ErrorCode.FILE_NOT_FOUND);
  });

  it('should refuse a student approving their own leave and leave it pending', async () => {
    const res = await gql(APPROVE_LEAVE, { id: studentLeaveId }, studentToken);

    expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    const after = await gql<{ leave: Leave }>(LEAVE, { id: studentLeaveId }, adminToken);
    expect(after.errors).toBeUndefined();
    expect(after.data?.leave.status).toBe(LeaveStatus.PENDING);
    expect(after.data?.leave.decidedBy).toBeNull();
  });

  it("should let the guardian read only the linked children's leaves", async () => {
    const read = await gql<{ leave: Leave }>(LEAVE, { id: studentLeaveId }, guardianToken);
    expect(read.errors).toBeUndefined();
    expect(read.data?.leave.userId).toBe(SEED_IDS.MEMBERSHIP_STUDENT_INST1);
    expect(read.data?.leave.files.map((file) => file.id)).toEqual([studentFileId]);
    expect((await downloadBytes(guardianToken, studentFileId)).equals(PDF)).toBe(true);

    // guardian1 is also linked to student2 by the e2e seed, so their leaves are in scope too.
    const children = [SEED_IDS.MEMBERSHIP_STUDENT_INST1, SEED_IDS.MEMBERSHIP_STUDENT_2];
    const leaves = await listLeaves(guardianToken);
    expect(leaves.map((leave) => leave.id)).toContain(studentLeaveId);
    expect(leaves.map((leave) => leave.id)).not.toContain(adminLeaveId);
    for (const leave of leaves) {
      expect(children).toContain(leave.userId);
    }

    const adminLeave = await gql(LEAVE, { id: adminLeaveId }, guardianToken);
    expect(codeOf(adminLeave)).toBe(ErrorCode.LEAVE_NOT_FOUND);
  });

  it('should let the guardian apply for a linked child', async () => {
    const res = await applyLeave(
      guardianToken,
      SEED_IDS.MEMBERSHIP_STUDENT_INST1,
      '2029-03-08',
      [],
    );

    expect(res.errors).toBeUndefined();
    const leave = res.data?.applyLeave;
    assert(leave);
    guardianLeaveId = leave.id;
    expect(leave.userId).toBe(SEED_IDS.MEMBERSHIP_STUDENT_INST1);
    expect(leave.status).toBe(LeaveStatus.PENDING);
  });

  it("should refuse the guardian's application for someone who is not their child", async () => {
    const res = await applyLeave(guardianToken, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2029-03-08', []);

    expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
  });

  it('should let a student withdraw a pending leave of their own', async () => {
    const created = await applyLeave(
      studentToken,
      SEED_IDS.MEMBERSHIP_STUDENT_INST1,
      '2029-03-09',
      [],
    );
    expect(created.errors).toBeUndefined();
    assert(created.data);
    withdrawnLeaveId = created.data.applyLeave.id;

    const res = await gql<{ cancelLeave: Leave }>(
      CANCEL_LEAVE,
      { id: withdrawnLeaveId },
      studentToken,
    );

    expect(res.errors).toBeUndefined();
    expect(res.data?.cancelLeave.status).toBe(LeaveStatus.CANCELLED);
    expect(res.data?.cancelLeave.decidedBy).toBe(SEED_IDS.MEMBERSHIP_STUDENT_INST1);
  });

  it('should let the admin see both leaves and record the admin as the approver', async () => {
    const ids = (await listLeaves(adminToken)).map((leave) => leave.id);
    expect(ids).toContain(studentLeaveId);
    expect(ids).toContain(adminLeaveId);

    const res = await gql<{ approveLeave: Leave }>(
      APPROVE_LEAVE,
      { id: studentLeaveId },
      adminToken,
    );

    expect(res.errors).toBeUndefined();
    expect(res.data?.approveLeave.status).toBe(LeaveStatus.APPROVED);
    expect(res.data?.approveLeave.decidedBy).toBe(SEED_IDS.MEMBERSHIP_ADMIN_INST1);
  });

  it('should refuse the student withdrawing the leave once it is approved', async () => {
    const res = await gql(CANCEL_LEAVE, { id: studentLeaveId }, studentToken);

    expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
    const after = await gql<{ leave: Leave }>(LEAVE, { id: studentLeaveId }, adminToken);
    expect(after.errors).toBeUndefined();
    expect(after.data?.leave.status).toBe(LeaveStatus.APPROVED);
  });

  it("should hide the student's leave from another institute's admin", async () => {
    const { accessToken } = await loginAsInstituteAdminSecondInstitute();

    const res = await gql(LEAVE, { id: studentLeaveId }, accessToken);

    expect(codeOf(res)).toBe(ErrorCode.LEAVE_NOT_FOUND);
  });
});

async function deleteLeaves(adminToken: string, ids: string[]) {
  for (const id of ids) {
    const res = await gql<{ deleteLeave: boolean }>(DELETE_LEAVE, { id }, adminToken);
    expect(res.errors).toBeUndefined();
    expect(res.data?.deleteLeave).toBe(true);
  }
}

describe('Leave authorization E2E — subject teacher', () => {
  const ownMembershipId = SEED.SUBJECT_TEACHER_USER.membershipId;
  let adminToken: string;
  let teacherToken: string;
  let ownLeaveId: string;
  let otherLeaveId: string;

  beforeAll(async () => {
    ({ accessToken: adminToken } = await loginAsInstituteAdmin());
    ({ accessToken: teacherToken } = await loginAsSubjectTeacher());

    const other = await applyLeave(adminToken, SEED_IDS.MEMBERSHIP_ADMIN_INST1, '2029-04-03', []);
    expect(other.errors).toBeUndefined();
    assert(other.data);
    otherLeaveId = other.data.applyLeave.id;
  });

  afterAll(async () => {
    await deleteLeaves(adminToken, [ownLeaveId, otherLeaveId].filter(Boolean));
  });

  it('should let the subject teacher apply for their own leave', async () => {
    const res = await applyLeave(teacherToken, ownMembershipId, '2029-04-02', []);

    expect(res.errors).toBeUndefined();
    const leave = res.data?.applyLeave;
    assert(leave);
    ownLeaveId = leave.id;
    expect(leave.userId).toBe(ownMembershipId);
    expect(leave.status).toBe(LeaveStatus.PENDING);
    expect(leave.decidedBy).toBeNull();
  });

  it('should let the subject teacher withdraw their own pending leave', async () => {
    const res = await gql<{ cancelLeave: Leave }>(CANCEL_LEAVE, { id: ownLeaveId }, teacherToken);

    expect(res.errors).toBeUndefined();
    expect(res.data?.cancelLeave.status).toBe(LeaveStatus.CANCELLED);
    expect(res.data?.cancelLeave.decidedBy).toBe(ownMembershipId);
  });

  it("should hide another person's leave from the subject teacher", async () => {
    const read = await gql<{ leave: Leave }>(LEAVE, { id: otherLeaveId }, teacherToken);
    const leaves = await listLeaves(teacherToken);

    expect(codeOf(read)).toBe(ErrorCode.LEAVE_NOT_FOUND);
    expect(leaves.map((leave) => leave.id)).toContain(ownLeaveId);
    for (const leave of leaves) {
      expect(leave.userId).toBe(ownMembershipId);
    }
  });

  it("should refuse the subject teacher deciding another person's leave and leave it pending", async () => {
    const approve = await gql(APPROVE_LEAVE, { id: otherLeaveId }, teacherToken);
    const reject = await gql(REJECT_LEAVE, { id: otherLeaveId }, teacherToken);
    const cancel = await gql(CANCEL_LEAVE, { id: otherLeaveId }, teacherToken);

    expect(codeOf(approve)).toBe(ErrorCode.FORBIDDEN);
    expect(codeOf(reject)).toBe(ErrorCode.FORBIDDEN);
    expect(codeOf(cancel)).toBe(ErrorCode.LEAVE_NOT_FOUND);
    const after = await gql<{ leave: Leave }>(LEAVE, { id: otherLeaveId }, adminToken);
    expect(after.errors).toBeUndefined();
    expect(after.data?.leave.status).toBe(LeaveStatus.PENDING);
    expect(after.data?.leave.decidedBy).toBeNull();
  });
});

describe('Leave authorization E2E — guardian of two children', () => {
  const [firstChild, secondChild] = SEED.MULTI_CHILD_GUARDIAN_USER.childMembershipIds;
  let adminToken: string;
  let guardianToken: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    ({ accessToken: adminToken } = await loginAsInstituteAdmin());
    ({ accessToken: guardianToken } = await loginAsMultiChildGuardian());
  });

  afterAll(async () => {
    await deleteLeaves(adminToken, createdIds);
  });

  it.each([
    ['first', firstChild],
    ['second', secondChild],
  ])('should let the guardian apply for their %s child', async (_, childMembershipId) => {
    const res = await applyLeave(guardianToken, childMembershipId, '2029-04-06', []);

    expect(res.errors).toBeUndefined();
    const leave = res.data?.applyLeave;
    assert(leave);
    createdIds.push(leave.id);
    expect(leave.userId).toBe(childMembershipId);
    expect(leave.status).toBe(LeaveStatus.PENDING);
  });

  it("should refuse the guardian's application for a student who is not their child", async () => {
    const res = await applyLeave(
      guardianToken,
      SEED_IDS.MEMBERSHIP_STUDENT_INST1,
      '2029-04-07',
      [],
    );

    expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN);
  });
});
