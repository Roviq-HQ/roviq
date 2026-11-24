/**
 * ROV-293: every staff and staff-qualification operation that takes an id refuses a staff
 * member, qualification or certificate file of another institute, returns none of its data,
 * and stores no reference to it.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode, QualificationType } from '@roviq/common-types';
import {
  type DrizzleDB,
  files,
  memberships,
  mkAdminCtx,
  SYSTEM_USER_ID,
  staffProfiles,
  staffQualifications,
  tenantUserProfiles,
  userProfiles,
  users,
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
import { eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { EicarFileScanner } from '../../../files/scan/eicar-file-scanner';
import { FileScanner } from '../../../files/scan/file-scanner';

const ORIGIN = 'test:staff-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

const GET = /* GraphQL */ `
  query GetStaffMember($id: ID!) {
    getStaffMember(id: $id) {
      id
      designation
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateStaffMember($id: ID!) {
    updateStaffMember(id: $id, input: { version: 1, firstName: { en: "Renamed" } }) {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteStaffMember($id: ID!) {
    deleteStaffMember(id: $id)
  }
`;
const RESTORE = /* GraphQL */ `
  mutation RestoreStaffMember($id: ID!) {
    restoreStaffMember(id: $id)
  }
`;
const LIST_QUALIFICATIONS = /* GraphQL */ `
  query ListStaffQualifications($staffProfileId: ID!) {
    listStaffQualifications(staffProfileId: $staffProfileId) {
      id
      staffProfileId
    }
  }
`;
const CREATE_QUALIFICATION = /* GraphQL */ `
  mutation CreateStaffQualification($input: CreateStaffQualificationInput!) {
    createStaffQualification(input: $input) {
      id
    }
  }
`;
const UPDATE_QUALIFICATION = /* GraphQL */ `
  mutation UpdateStaffQualification($id: ID!, $input: UpdateStaffQualificationInput!) {
    updateStaffQualification(id: $id, input: $input) {
      id
    }
  }
`;
const DELETE_QUALIFICATION = /* GraphQL */ `
  mutation DeleteStaffQualification($id: ID!) {
    deleteStaffQualification(id: $id)
  }
`;

interface Fixture {
  staffId: string;
  deletedStaffId: string;
  qualificationId: string;
  /** Certificate scans the institute's admin uploaded and has not attached yet. */
  fileIds: [string, string];
}

describe('staff: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  const storage = new FakeStorageClient();
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Fixture;
  let b: Fixture;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /**
   * Staff, qualification, membership, profile-copy and file rows of both institutes, and every
   * qualification anywhere that points at B's staff or files.
   */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      return {
        staff: await tx
          .select()
          .from(staffProfiles)
          .where(inArray(staffProfiles.tenantId, tenants))
          .orderBy(staffProfiles.id),
        qualifications: await tx
          .select()
          .from(staffQualifications)
          .where(
            or(
              inArray(staffQualifications.tenantId, tenants),
              inArray(staffQualifications.staffProfileId, [b.staffId, b.deletedStaffId]),
              inArray(staffQualifications.certificateFileId, b.fileIds),
            ),
          )
          .orderBy(staffQualifications.id),
        memberships: await tx
          .select()
          .from(memberships)
          .where(inArray(memberships.tenantId, tenants))
          .orderBy(memberships.id),
        copies: await tx
          .select()
          .from(tenantUserProfiles)
          .where(inArray(tenantUserProfiles.tenantId, tenants))
          .orderBy(tenantUserProfiles.id),
        files: await tx
          .select()
          .from(files)
          .where(
            or(
              inArray(files.tenantId, tenants),
              inArray(files.uploadedBy, [instA.userId, instB.userId]),
            ),
          )
          .orderBy(files.id),
      };
    });

  const setUp = (inst: TestInstitute) =>
    asAdmin(async (tx): Promise<Fixture> => {
      const addStaff = async (name: string, deletedAt: Date | null) => {
        const suffix = randomUUID().slice(0, 8);
        const [user] = await tx
          .insert(users)
          .values({
            email: `staff_fid_${suffix}@test.local`,
            username: `staff_fid_${suffix}`,
            passwordHash: 'not-a-real-hash',
            ...BY,
          })
          .returning({ id: users.id });
        await tx.insert(userProfiles).values({ userId: user.id, firstName: { en: name }, ...BY });
        await tx.insert(tenantUserProfiles).values({
          tenantId: inst.tenantId,
          userId: user.id,
          firstName: { en: name },
          ...BY,
        });
        const [membership] = await tx
          .insert(memberships)
          .values({
            userId: user.id,
            roleId: inst.roleId,
            tenantId: inst.tenantId,
            abilities: [],
            ...BY,
          })
          .returning({ id: memberships.id });
        const [profile] = await tx
          .insert(staffProfiles)
          .values({
            tenantId: inst.tenantId,
            userId: user.id,
            membershipId: membership.id,
            employeeId: `EMP-${suffix}`,
            designation: 'Teacher',
            dateOfJoining: '2025-06-01',
            deletedAt,
            deletedBy: deletedAt ? SYSTEM_USER_ID : null,
            ...BY,
          })
          .returning({ id: staffProfiles.id });
        return profile.id;
      };
      const addFile = async () => {
        const objectKey = `institutes/${inst.tenantId}/staff-certificate/${randomUUID()}.pdf`;
        await storage.put('private', `pending/${objectKey}`, PDF, {
          contentType: 'application/pdf',
        });
        const [file] = await tx
          .insert(files)
          .values({
            tenantId: inst.tenantId,
            visibility: 'PRIVATE',
            purpose: 'STAFF_CERTIFICATE',
            objectKey,
            originalName: 'certificate.pdf',
            contentType: 'application/pdf',
            sizeBytes: PDF.length,
            status: 'PENDING',
            uploadedBy: inst.userId,
            createdBy: inst.userId,
            updatedBy: inst.userId,
          })
          .returning({ id: files.id });
        return file.id;
      };
      const staffId = await addStaff('Meera', null);
      const deletedStaffId = await addStaff('Rohit', new Date());
      const [qualification] = await tx
        .insert(staffQualifications)
        .values({
          tenantId: inst.tenantId,
          staffProfileId: staffId,
          type: QualificationType.ACADEMIC,
          degreeName: 'B.Ed',
          ...BY,
        })
        .returning({ id: staffQualifications.id });
      return {
        staffId,
        deletedStaffId,
        qualificationId: qualification.id,
        fileIds: [await addFile(), await addFile()],
      };
    });

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

  const qualificationRow = (id: string) =>
    asAdmin((tx) =>
      tx
        .select({
          tenantId: staffQualifications.tenantId,
          staffProfileId: staffQualifications.staffProfileId,
          certificateFileId: staffQualifications.certificateFileId,
        })
        .from(staffQualifications)
        .where(eq(staffQualifications.id, id)),
    );

  const fileStatus = async (id: string) => {
    const [row] = await asAdmin((tx) =>
      tx.select({ status: files.status }).from(files).where(eq(files.id, id)),
    );
    return row?.status;
  };

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
  });

  afterAll(async () => {
    await result?.close();
  });

  it('getStaffMember should refuse a staff member of another institute and return none of it', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: GET,
      variables: { id: b.staffId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.STAFF_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it.each([
    ['updateStaffMember', UPDATE, () => b.staffId],
    ['deleteStaffMember', DELETE, () => b.staffId],
    ['restoreStaffMember', RESTORE, () => b.deletedStaffId],
  ] as const)('%s should refuse a staff member of another institute and change neither institute', async (_operation, query, id) => {
    await refusesAndWritesNothing(query, { id: id() }, ErrorCode.STAFF_NOT_FOUND);
  });

  it('listStaffQualifications should list its own staff member and nothing of another institute staff member', async () => {
    const own = await gqlRequest<{ listStaffQualifications: unknown[] }>(result.httpServer, {
      query: LIST_QUALIFICATIONS,
      variables: { staffProfileId: a.staffId },
      token: tokenA,
    });
    const foreign = await gqlRequest<{ listStaffQualifications: unknown[] }>(result.httpServer, {
      query: LIST_QUALIFICATIONS,
      variables: { staffProfileId: b.staffId },
      token: tokenA,
    });

    expect(own.errors).toBeUndefined();
    expect(own.data?.listStaffQualifications).toEqual([
      { id: a.qualificationId, staffProfileId: a.staffId },
    ]);
    expect(foreign.errors).toBeUndefined();
    expect(foreign.data?.listStaffQualifications).toEqual([]);
  });

  it.each([
    ['updateStaffQualification', UPDATE_QUALIFICATION, { input: { degreeName: 'M.Ed' } }],
    ['deleteStaffQualification', DELETE_QUALIFICATION, {}],
  ] as const)('%s should refuse a qualification of another institute and change neither institute', async (_operation, query, extra) => {
    await refusesAndWritesNothing(
      query,
      { id: b.qualificationId, ...extra },
      ErrorCode.STAFF_QUALIFICATION_NOT_FOUND,
    );
  });

  describe('createStaffQualification', () => {
    const create = (staffProfileId: string, certificateFileId?: string) => ({
      input: {
        staffProfileId,
        certificateFileId,
        type: QualificationType.PROFESSIONAL,
        degreeName: 'CTET',
      },
    });

    it.each([
      ['staffProfileId', () => create(b.staffId), ErrorCode.STAFF_NOT_FOUND],
      [
        'staffProfileId with its own file',
        () => create(b.staffId, a.fileIds[0]),
        ErrorCode.STAFF_NOT_FOUND,
      ],
      ['certificateFileId', () => create(a.staffId, b.fileIds[0]), ErrorCode.FILE_NOT_FOUND],
    ] as const)('should refuse %s of another institute and write nothing', async (_field, variables, code) => {
      await refusesAndWritesNothing(CREATE_QUALIFICATION, variables(), code);
    });

    it('should store a qualification of its own staff member with its own certificate', async () => {
      const res = await gqlRequest<{ createStaffQualification: { id: string } }>(
        result.httpServer,
        { query: CREATE_QUALIFICATION, variables: create(a.staffId, a.fileIds[0]), token: tokenA },
      );

      expect(res.errors).toBeUndefined();
      expect(await qualificationRow(res.data?.createStaffQualification.id ?? '')).toEqual([
        { tenantId: instA.tenantId, staffProfileId: a.staffId, certificateFileId: a.fileIds[0] },
      ]);
      expect(await fileStatus(a.fileIds[0])).toBe('READY');
    });
  });

  describe('updateStaffQualification certificateFileId', () => {
    it('should refuse a certificate of another institute and write nothing', async () => {
      await refusesAndWritesNothing(
        UPDATE_QUALIFICATION,
        { id: a.qualificationId, input: { certificateFileId: b.fileIds[1] } },
        ErrorCode.FILE_NOT_FOUND,
      );
    });

    it('should attach its own certificate to its own qualification', async () => {
      const res = await gqlRequest(result.httpServer, {
        query: UPDATE_QUALIFICATION,
        variables: { id: a.qualificationId, input: { certificateFileId: a.fileIds[1] } },
        token: tokenA,
      });

      expect(res.errors).toBeUndefined();
      expect(await qualificationRow(a.qualificationId)).toEqual([
        { tenantId: instA.tenantId, staffProfileId: a.staffId, certificateFileId: a.fileIds[1] },
      ]);
      expect(await fileStatus(a.fileIds[1])).toBe('READY');
    });
  });
});
