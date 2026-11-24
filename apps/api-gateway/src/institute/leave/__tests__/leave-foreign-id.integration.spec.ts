/**
 * ROV-293: every leave operation that takes an id refuses a leave, membership or attachment of
 * another institute, returns none of its data, and stores no reference to it.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  type DrizzleDB,
  files,
  leaveFiles,
  leaves,
  mkAdminCtx,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { EicarFileScanner } from '../../../files/scan/eicar-file-scanner';
import { FileScanner } from '../../../files/scan/file-scanner';

const ORIGIN = 'test:leave-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const DAY = '2026-12-02';

const LEAVE = /* GraphQL */ `
  query Leave($id: ID!) {
    leave(id: $id) {
      id
      reason
    }
  }
`;
const LEAVES = /* GraphQL */ `
  query Leaves($userId: ID) {
    leaves(userId: $userId) {
      id
      userId
    }
  }
`;
const APPLY = /* GraphQL */ `
  mutation ApplyLeave($userId: ID!, $fileIds: [ID!]) {
    applyLeave(
      input: {
        userId: $userId
        startDate: "2026-12-03"
        endDate: "2026-12-03"
        type: CASUAL
        reason: "Family function"
        fileIds: $fileIds
      }
    ) {
      id
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateLeave($id: ID!, $fileIds: [ID!]) {
    updateLeave(id: $id, input: { reason: "Edited", fileIds: $fileIds }) {
      id
    }
  }
`;
const APPROVE = /* GraphQL */ `
  mutation ApproveLeave($id: ID!) {
    approveLeave(id: $id) {
      id
    }
  }
`;
const REJECT = /* GraphQL */ `
  mutation RejectLeave($id: ID!) {
    rejectLeave(id: $id) {
      id
    }
  }
`;
const CANCEL = /* GraphQL */ `
  mutation CancelLeave($id: ID!) {
    cancelLeave(id: $id) {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteLeave($id: ID!) {
    deleteLeave(id: $id)
  }
`;

interface Fixture {
  /** A PENDING leave of the institute's admin. */
  leaveId: string;
  /** A leave attachment the institute's admin uploaded and has not attached yet. */
  fileId: string;
}

describe('leave: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  const storage = new FakeStorageClient();
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Fixture;
  let b: Fixture;
  /** Uploaded by A's own account, but in institute B. */
  let callerFileInB: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Leaves, attachments and files of both institutes, and every row anywhere pointing at B's. */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      const foreignFiles = [b.fileId, callerFileInB];
      return {
        leaves: await tx
          .select()
          .from(leaves)
          .where(
            or(
              inArray(leaves.tenantId, tenants),
              eq(leaves.userId, instB.membershipId),
              eq(leaves.decidedBy, instB.membershipId),
            ),
          )
          .orderBy(asc(leaves.id)),
        leaveFiles: await tx
          .select()
          .from(leaveFiles)
          .where(
            or(
              inArray(leaveFiles.tenantId, tenants),
              eq(leaveFiles.leaveId, b.leaveId),
              inArray(leaveFiles.fileId, foreignFiles),
            ),
          )
          .orderBy(asc(leaveFiles.id)),
        files: await tx
          .select()
          .from(files)
          .where(
            or(
              inArray(files.tenantId, tenants),
              inArray(files.uploadedBy, [instA.userId, instB.userId]),
            ),
          )
          .orderBy(asc(files.id)),
      };
    });

  const addFile = async (tx: DrizzleDB, tenantId: string, uploadedBy: string) => {
    const objectKey = `institutes/${tenantId}/leave-attachment/${randomUUID()}.pdf`;
    await storage.put('private', `pending/${objectKey}`, PDF, { contentType: 'application/pdf' });
    const [row] = await tx
      .insert(files)
      .values({
        tenantId,
        visibility: 'PRIVATE',
        purpose: 'LEAVE_ATTACHMENT',
        objectKey,
        originalName: 'medical.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
        status: 'PENDING',
        uploadedBy,
        createdBy: uploadedBy,
        updatedBy: uploadedBy,
      })
      .returning({ id: files.id });
    return row.id;
  };

  const addLeave = async (tx: DrizzleDB, inst: TestInstitute) => {
    const [row] = await tx
      .insert(leaves)
      .values({
        tenantId: inst.tenantId,
        userId: inst.membershipId,
        startDate: DAY,
        endDate: DAY,
        type: 'CASUAL',
        reason: 'Wedding',
        ...BY,
      })
      .returning({ id: leaves.id });
    return row.id;
  };

  const setUp = (inst: TestInstitute) =>
    asAdmin(
      async (tx): Promise<Fixture> => ({
        leaveId: await addLeave(tx, inst),
        fileId: await addFile(tx, inst.tenantId, inst.userId),
      }),
    );

  const refusesAndWritesNothing = async (
    query: string,
    variables: Record<string, unknown>,
    code: string,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await gqlRequest(result.httpServer, { query, variables, token: tokenA });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  };

  const attachmentsOf = (leaveId: string) =>
    asAdmin((tx) =>
      tx
        .select({ fileId: leaveFiles.fileId, status: files.status })
        .from(leaveFiles)
        .innerJoin(files, eq(files.id, leaveFiles.fileId))
        .where(eq(leaveFiles.leaveId, leaveId)),
    );

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: storage },
        { provide: FileScanner, useValue: new EicarFileScanner() },
      ],
    });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    a = await setUp(instA);
    b = await setUp(instB);
    callerFileInB = await asAdmin((tx) => addFile(tx, instB.tenantId, instA.userId));
  });

  afterAll(async () => {
    await result?.close();
  });

  it('leave should refuse a leave of another institute and return none of it', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: LEAVE,
      variables: { id: b.leaveId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.LEAVE_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it('leaves should list its own member and nothing of a member of another institute', async () => {
    const own = await gqlRequest<{ leaves: unknown[] }>(result.httpServer, {
      query: LEAVES,
      variables: { userId: instA.membershipId },
      token: tokenA,
    });
    const foreign = await gqlRequest<{ leaves: unknown[] }>(result.httpServer, {
      query: LEAVES,
      variables: { userId: instB.membershipId },
      token: tokenA,
    });

    expect(own.errors).toBeUndefined();
    expect(own.data?.leaves).toEqual([{ id: a.leaveId, userId: instA.membershipId }]);
    expect(foreign.errors).toBeUndefined();
    expect(foreign.data?.leaves).toEqual([]);
  });

  it('applyLeave should store a leave for its own member with its own attachment', async () => {
    const fileId = await asAdmin((tx) => addFile(tx, instA.tenantId, instA.userId));

    const res = await gqlRequest<{ applyLeave: { id: string } }>(result.httpServer, {
      query: APPLY,
      variables: { userId: instA.membershipId, fileIds: [fileId] },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    const id = res.data?.applyLeave.id ?? '';
    const [stored] = await asAdmin((tx) =>
      tx
        .select({ tenantId: leaves.tenantId, userId: leaves.userId })
        .from(leaves)
        .where(eq(leaves.id, id)),
    );
    expect(stored).toEqual({ tenantId: instA.tenantId, userId: instA.membershipId });
    expect(await attachmentsOf(id)).toEqual([{ fileId, status: 'READY' }]);
  });

  // FORBIDDEN, as for a membership that does not exist: the answer reveals nothing of B.
  it('applyLeave should refuse a member of another institute and write nothing', async () => {
    await refusesAndWritesNothing(APPLY, { userId: instB.membershipId }, ErrorCode.FORBIDDEN);
  });

  it.each([
    ['uploaded there', () => b.fileId],
    ['uploaded there by the caller', () => callerFileInB],
  ] as const)('applyLeave should refuse an attachment of another institute %s and write nothing', async (_case, fileId) => {
    await refusesAndWritesNothing(
      APPLY,
      { userId: instA.membershipId, fileIds: [fileId()] },
      ErrorCode.FILE_NOT_FOUND,
    );
  });

  it('updateLeave should attach its own upload to its own leave', async () => {
    const leaveId = await asAdmin((tx) => addLeave(tx, instA));
    const fileId = await asAdmin((tx) => addFile(tx, instA.tenantId, instA.userId));

    const res = await gqlRequest<{ updateLeave: { id: string } }>(result.httpServer, {
      query: UPDATE,
      variables: { id: leaveId, fileIds: [fileId] },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    expect(await attachmentsOf(leaveId)).toEqual([{ fileId, status: 'READY' }]);
  });

  it.each([
    ['uploaded there', () => b.fileId],
    ['uploaded there by the caller', () => callerFileInB],
  ] as const)('updateLeave should refuse an attachment of another institute %s and write nothing', async (_case, fileId) => {
    await refusesAndWritesNothing(
      UPDATE,
      { id: a.leaveId, fileIds: [fileId()] },
      ErrorCode.FILE_NOT_FOUND,
    );
  });

  it.each([
    ['updateLeave', UPDATE],
    ['approveLeave', APPROVE],
    ['rejectLeave', REJECT],
    ['cancelLeave', CANCEL],
    ['deleteLeave', DELETE],
  ] as const)('%s should refuse a leave of another institute and change neither institute', async (_operation, query) => {
    await refusesAndWritesNothing(query, { id: b.leaveId }, ErrorCode.LEAVE_NOT_FOUND);
  });
});
