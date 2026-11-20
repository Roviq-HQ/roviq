/**
 * ROV-169 — Unit tests for StaffQualificationService (no DB).
 *
 * Pure unit test that mocks `@roviq/database`'s `withTenant`/`withAdmin`
 * wrappers and provides a chainable Proxy-based fake transaction so the
 * service's Drizzle builder calls resolve to queued results. This pattern
 * mirrors `guardian-linking.spec.ts` — the only way to unit-test a service
 * that speaks fluent Drizzle without hitting a real database.
 */

import { ErrorCode, QualificationType } from '@roviq/common-types';
import { type DrizzleDB, staffQualifications } from '@roviq/database';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileService } from '../../../files/file.service';

// ── Sequential result queue (shared between `withTenant` and `withAdmin`) ──

const resultQueue: unknown[] = [];
let queueIndex = 0;

function queueResult(result: unknown) {
  resultQueue.push(result);
}

function resetQueue() {
  resultQueue.length = 0;
  queueIndex = 0;
}

function nextResult(): unknown {
  const result = resultQueue[queueIndex] ?? [];
  queueIndex++;
  return result;
}

function createMockTx() {
  const terminal = vi.fn(() => Promise.resolve(nextResult()));
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'limit' || prop === 'returning') return terminal;
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(nextResult());
        }
        return vi.fn(() => chain);
      },
    },
  );
  return chain;
}

const tx = createMockTx();

async function mockWithContext(_db: unknown, ...args: unknown[]) {
  const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
  return fn(tx);
}

const softDeleteMock = vi.hoisted(() => vi.fn());

vi.mock('@roviq/database', () => ({
  DRIZZLE_DB: Symbol('DRIZZLE_DB'),
  softDelete: softDeleteMock,
  withAdmin: vi.fn(mockWithContext),
  withTenant: vi.fn(mockWithContext),
  staffQualifications: {
    deletedAt: 'deleted_at',
    id: 'id',
    staffProfileId: 'staff_profile_id',
    tenantId: 'tenant_id',
    type: 'type',
    degreeName: 'degree_name',
  },
  academicYearsLive: { __tableName: 'academicYearsLive' },
  admissionApplicationsLive: { __tableName: 'admissionApplicationsLive' },
  attendanceEntriesLive: { __tableName: 'attendanceEntriesLive' },
  attendanceSessionsLive: { __tableName: 'attendanceSessionsLive' },
  botProfilesLive: { __tableName: 'botProfilesLive' },
  enquiriesLive: { __tableName: 'enquiriesLive' },
  groupsLive: { __tableName: 'groupsLive' },
  guardianProfilesLive: { __tableName: 'guardianProfilesLive' },
  holidaysLive: { __tableName: 'holidaysLive' },
  instituteAffiliationsLive: { __tableName: 'instituteAffiliationsLive' },
  instituteBrandingLive: { __tableName: 'instituteBrandingLive' },
  instituteConfigsLive: { __tableName: 'instituteConfigsLive' },
  instituteGroupBrandingLive: { __tableName: 'instituteGroupBrandingLive' },
  instituteIdentifiersLive: { __tableName: 'instituteIdentifiersLive' },
  institutesLive: { __tableName: 'institutesLive' },
  issuedCertificatesLive: { __tableName: 'issuedCertificatesLive' },
  leavesLive: { __tableName: 'leavesLive' },
  membershipsLive: { __tableName: 'membershipsLive' },
  rolesLive: { __tableName: 'rolesLive' },
  sectionSubjectsLive: { __tableName: 'sectionSubjectsLive' },
  sectionsLive: { __tableName: 'sectionsLive' },
  staffProfilesLive: { __tableName: 'staffProfilesLive' },
  standardSubjectsLive: { __tableName: 'standardSubjectsLive' },
  standardsLive: { __tableName: 'standardsLive' },
  studentAcademicsLive: { __tableName: 'studentAcademicsLive' },
  studentProfilesLive: { __tableName: 'studentProfilesLive' },
  subjectsLive: { __tableName: 'subjectsLive' },
  tcRegisterLive: { __tableName: 'tcRegisterLive' },
  mkInstituteCtx: (tenantId: string) => ({
    _scope: 'institute',
    scope: 'institute',
    tenantId,
    userId: 'u',
    membershipId: 'm',
    roleId: 'r',
    type: 'access',
  }),
  mkResellerCtx: (resellerId: string) => ({
    _scope: 'reseller',
    scope: 'reseller',
    resellerId,
    userId: 'u',
    membershipId: 'm',
    roleId: 'r',
    type: 'access',
  }),
  mkAdminCtx: () => ({
    _scope: 'platform',
    scope: 'platform',
    userId: 'u',
    membershipId: 'm',
    roleId: 'r',
    type: 'access',
  }),
  usersLive: { __tableName: 'usersLive' },
  refreshTokensLive: { __tableName: 'refreshTokensLive' },
  phoneNumbersLive: { __tableName: 'phoneNumbersLive' },
  authProvidersLive: { __tableName: 'authProvidersLive' },
  platformMembershipsLive: { __tableName: 'platformMembershipsLive' },
  resellerMembershipsLive: { __tableName: 'resellerMembershipsLive' },
  groupMembershipsLive: { __tableName: 'groupMembershipsLive' },
  userProfilesLive: { __tableName: 'userProfilesLive' },
  userAddressesLive: { __tableName: 'userAddressesLive' },
  userDocumentsLive: { __tableName: 'userDocumentsLive' },
  userIdentifiersLive: { __tableName: 'userIdentifiersLive' },
  studentGuardianLinksLive: { __tableName: 'studentGuardianLinksLive' },
  staffQualificationsLive: {
    id: 'id',
    staffProfileId: 'staff_profile_id',
    tenantId: 'tenant_id',
    type: 'type',
    degreeName: 'degree_name',
  },
  privacyNoticesLive: { __tableName: 'privacyNoticesLive' },
  certificateTemplatesLive: { __tableName: 'certificateTemplatesLive' },
  applicationDocumentsLive: { __tableName: 'applicationDocumentsLive' },
  groupRulesLive: { __tableName: 'groupRulesLive' },
  groupMembersLive: { __tableName: 'groupMembersLive' },
  groupChildrenLive: { __tableName: 'groupChildrenLive' },
}));

const markFilesReady = vi.hoisted(() => vi.fn());
const markFilesDeleted = vi.hoisted(() => vi.fn());
vi.mock('../../../files/file-attachment', () => ({ markFilesReady, markFilesDeleted }));
// The service imports FileService for its type only; its module pulls in storage and sharp.
vi.mock('../../../files/file.service', () => ({ FileService: class {} }));

vi.mock('@roviq/request-context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    correlationId: 'test',
  })),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => [a, b]),
  asc: vi.fn((col: unknown) => col),
  isNull: vi.fn((a: unknown) => ['isNull', a]),
}));

const verifyUploads = vi.fn();

async function createService() {
  const mod = await import('../staff-qualification.service');
  return new mod.StaffQualificationService(
    createMock<DrizzleDB>(),
    createMock<FileService>({ verifyUploads }),
  );
}

// The fake transaction is a Proxy, which deep equality cannot compare: check identity instead.
function expectTxCall(mock: ReturnType<typeof vi.fn>, params: Record<string, unknown>) {
  expect(mock).toHaveBeenCalledOnce();
  expect(mock.mock.calls[0]?.[0]).toBe(tx);
  expect(mock.mock.calls[0]?.[1]).toEqual(params);
}

describe('StaffQualificationService (unit)', () => {
  let service: Awaited<ReturnType<typeof createService>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetQueue();
    service = await createService();
  });

  it('listForStaff returns the rows from the mocked select chain', async () => {
    const rows = [
      { id: 'q1', degreeName: 'B.Ed', type: QualificationType.ACADEMIC },
      { id: 'q2', degreeName: 'M.Sc', type: QualificationType.ACADEMIC },
    ];
    queueResult(rows);

    const result = await service.listForStaff('staff-1');

    expect(result).toEqual(rows);
  });

  describe('create', () => {
    const input = {
      staffProfileId: 'staff-1',
      type: QualificationType.ACADEMIC,
      degreeName: 'B.Ed',
    };
    const inserted = { id: 'q3', tenantId: 'tenant-1', ...input };

    it('should return the inserted row and touch no file when there is no certificate', async () => {
      queueResult([{ id: 'staff-1' }]);
      queueResult([inserted]);

      const result = await service.create(input);

      expect(result).toEqual(inserted);
      expect(verifyUploads).not.toHaveBeenCalled();
      expect(markFilesReady).not.toHaveBeenCalled();
    });

    it('should verify the certificate upload and make it ready with the row', async () => {
      queueResult([{ id: 'staff-1' }]);
      queueResult([{ ...inserted, certificateFileId: 'file-1' }]);

      await service.create({ ...input, certificateFileId: 'file-1' });

      expect(verifyUploads).toHaveBeenCalledWith(['file-1'], 'STAFF_CERTIFICATE');
      expectTxCall(markFilesReady, {
        fileIds: ['file-1'],
        purpose: 'STAFF_CERTIFICATE',
        userId: 'user-1',
      });
    });

    it('should refuse a staff member that is not in this institute before looking at the file', async () => {
      queueResult([]);

      await expect(service.create({ ...input, certificateFileId: 'file-1' })).rejects.toMatchObject(
        { code: ErrorCode.STAFF_NOT_FOUND },
      );
      expect(verifyUploads).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const updated = { id: 'q4', degreeName: 'B.Ed (Revised)' };

    it('should keep the certificate when the input does not mention it', async () => {
      queueResult([{ id: 'q4', certificateFileId: 'old-file' }]);
      queueResult([updated]);

      const result = await service.update('q4', { degreeName: 'B.Ed (Revised)' });

      expect(result).toEqual(updated);
      expect(verifyUploads).not.toHaveBeenCalled();
      expect(markFilesReady).not.toHaveBeenCalled();
      expect(markFilesDeleted).not.toHaveBeenCalled();
    });

    it('should attach the new certificate and delete the one it replaces', async () => {
      queueResult([{ id: 'q4', certificateFileId: 'old-file' }]);
      queueResult([updated]);

      await service.update('q4', { certificateFileId: 'new-file' });

      expect(verifyUploads).toHaveBeenCalledWith(['new-file'], 'STAFF_CERTIFICATE');
      expectTxCall(markFilesReady, {
        fileIds: ['new-file'],
        purpose: 'STAFF_CERTIFICATE',
        userId: 'user-1',
      });
      expectTxCall(markFilesDeleted, {
        fileIds: ['old-file'],
        userId: 'user-1',
      });
    });

    it('should delete the certificate when the input sets it to null', async () => {
      queueResult([{ id: 'q4', certificateFileId: 'old-file' }]);
      queueResult([updated]);

      await service.update('q4', { certificateFileId: null });

      expect(verifyUploads).not.toHaveBeenCalled();
      expect(markFilesReady).not.toHaveBeenCalled();
      expectTxCall(markFilesDeleted, {
        fileIds: ['old-file'],
        userId: 'user-1',
      });
    });

    it('should do nothing to files when the same certificate is sent again', async () => {
      queueResult([{ id: 'q4', certificateFileId: 'old-file' }]);
      queueResult([updated]);

      await service.update('q4', { certificateFileId: 'old-file' });

      expect(verifyUploads).not.toHaveBeenCalled();
      expect(markFilesDeleted).not.toHaveBeenCalled();
    });

    it('should reject when no live row matches', async () => {
      queueResult([]);

      await expect(service.update('missing', { degreeName: 'X' })).rejects.toMatchObject({
        code: ErrorCode.STAFF_QUALIFICATION_NOT_FOUND,
      });
    });
  });

  describe('delete', () => {
    it('should soft-delete the row together with its certificate', async () => {
      queueResult([{ id: 'q5', certificateFileId: 'file-5' }]);
      softDeleteMock.mockResolvedValueOnce(undefined);

      const result = await service.delete('q5');

      expect(result).toBe(true);
      expect(softDeleteMock).toHaveBeenCalledOnce();
      expect(softDeleteMock.mock.calls[0]?.[0]).toBe(tx);
      expect(softDeleteMock.mock.calls[0]?.slice(1)).toEqual([staffQualifications, 'q5']);
      expectTxCall(markFilesDeleted, { fileIds: ['file-5'], userId: 'user-1' });
    });

    it('should reject when no live row matches', async () => {
      queueResult([]);

      await expect(service.delete('missing')).rejects.toMatchObject({
        code: ErrorCode.STAFF_QUALIFICATION_NOT_FOUND,
      });
      expect(softDeleteMock).not.toHaveBeenCalled();
    });
  });
});
