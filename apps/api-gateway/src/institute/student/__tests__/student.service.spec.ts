/**
 * ROV-167 — Unit tests for StudentService (no DB).
 *
 * Mocks `@roviq/database`'s `withTenant`/`withAdmin` wrappers with a
 * chainable Proxy-based fake transaction so the service's Drizzle builder
 * calls resolve against a sequential result queue. Mirrors the pattern in
 * `staff-qualification.spec.ts` — the only way to unit-test a service that
 * speaks fluent Drizzle without hitting a real database.
 */

import { createMongoAbility } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import { AcademicStatus, ErrorCode, SocialCategory } from '@roviq/common-types';
import type { DrizzleDB } from '@roviq/database';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityService } from '../../../auth/identity.service';
import type { FileService } from '../../../files/file.service';
import type { StudentReadRepository } from '../student-read.repository';

// ── Sequential result queue ───────────────────────────────────

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
        if (prop === 'limit' || prop === 'returning' || prop === 'groupBy') return terminal;
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(nextResult());
        }
        return vi.fn(() => chain);
      },
    },
  );
  return chain;
}

async function mockWithContext(_db: unknown, ...args: unknown[]) {
  const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
  return fn(createMockTx());
}

// Reusable empty-schema columns (accessed by the service for WHERE/set).
const col = new Proxy(
  {},
  {
    get: () => 'col',
  },
);

vi.mock('@roviq/database', () => ({
  DRIZZLE_DB: Symbol('DRIZZLE_DB'),
  withAdmin: vi.fn(mockWithContext),
  withTenant: vi.fn(mockWithContext),
  studentProfiles: col,
  studentAcademics: col,
  userProfiles: col,
  users: col,
  phoneNumbers: col,
  memberships: col,
  roles: col,
  academicYears: col,
  standards: col,
  sections: col,
  instituteConfigs: col,
  tenantSequences: col,
  guardianProfiles: col,
  studentGuardianLinks: col,
  userDocuments: col,
  userDocumentFiles: col,
  files: col,
  filesLive: { __tableName: 'filesLive' },
  userDocumentFilesLive: { __tableName: 'userDocumentFilesLive' },
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
  staffQualificationsLive: { __tableName: 'staffQualificationsLive' },
  privacyNoticesLive: { __tableName: 'privacyNoticesLive' },
  certificateTemplatesLive: { __tableName: 'certificateTemplatesLive' },
  applicationDocumentsLive: { __tableName: 'applicationDocumentsLive' },
  groupRulesLive: { __tableName: 'groupRulesLive' },
  groupMembersLive: { __tableName: 'groupMembersLive' },
  groupChildrenLive: { __tableName: 'groupChildrenLive' },
}));

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
  or: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((col: unknown) => col),
  desc: vi.fn((col: unknown) => col),
  ilike: vi.fn((a: unknown, b: unknown) => [a, b]),
  inArray: vi.fn((a: unknown, b: unknown) => [a, b]),
  exists: vi.fn((query: unknown) => ['exists', query]),
  isNull: vi.fn((a: unknown) => ['isNull', a]),
  notInArray: vi.fn((a: unknown, b: unknown) => [a, b]),
  count: vi.fn(() => 'count'),
  sql: Object.assign(
    vi.fn(() => 'sql'),
    { raw: vi.fn(() => 'raw') },
  ),
}));

vi.mock('drizzle-orm/pg-core', () => {
  const chain = { from: () => chain, where: () => chain, leftJoin: () => chain };
  return {
    alias: vi.fn(() => col),
    QueryBuilder: class {
      select() {
        return chain;
      }
    },
  };
});

vi.mock('../../../files/user-document-files', () => ({
  attachUserDocumentFiles: vi.fn(),
  loadUserDocumentFiles: vi.fn(),
  removeUserDocument: vi.fn(),
}));

// Mock status-machine to isolate update() behavior from transition rules.
vi.mock('../student.state-machine', () => ({
  STUDENT_ACADEMIC_STATE_MACHINE: {
    assertTransition: vi.fn(),
    canTransition: vi.fn(() => true),
  },
}));

interface MockEventBus {
  emit: ReturnType<typeof vi.fn>;
}

let readRepository: StudentReadRepository;
async function createService(eventBus: MockEventBus) {
  const mod = await import('../student.service');
  const { StudentReadRepository } = await import('../student-read.repository');
  const db = createMock<DrizzleDB>();
  readRepository = new StudentReadRepository(db);
  return new mod.StudentService(
    db,
    createMock<EventBusService>({ emit: eventBus.emit }),
    createMock<IdentityService>(),
    readRepository,
    createMock<FileService>(),
  );
}

describe('StudentService (unit)', () => {
  let service: Awaited<ReturnType<typeof createService>>;
  let eventBus: MockEventBus;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetQueue();
    eventBus = { emit: vi.fn() };
    service = await createService(eventBus);
  });

  describe('update', () => {
    it('rejects with CONCURRENT_MODIFICATION on version mismatch', async () => {
      // Update (.returning()) resolves to [] → version mismatch path.
      queueResult([]);
      // throwVersionConflict selects the row → still exists, so conflict.
      queueResult([{ id: 'student-1' }]);

      const promise = service.update('student-1', {
        version: 1,
        socialCategory: SocialCategory.GENERAL,
      });
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.CONCURRENT_MODIFICATION });
      await expect(
        // Re-run with same queue state (already consumed) would fail — so assert
        // via a single caught error below.
        promise.catch((e: unknown) => {
          throw e;
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONCURRENT_MODIFICATION });
    });

    it('rejects when the student does not exist', async () => {
      // Update returns [] → fall through to throwVersionConflict.
      queueResult([]);
      // throwVersionConflict select → not found.
      queueResult([]);

      await expect(
        service.update('missing', { version: 1, socialCategory: SocialCategory.GENERAL }),
      ).rejects.toMatchObject({ code: ErrorCode.STUDENT_NOT_FOUND });
    });

    it('emits STUDENT.left when academicStatus transitions to a departure status', async () => {
      // validateStatusChange → current row exists. tcIssued must be true so the
      // TRANSFERRED_OUT guard (now inline in the service) does not reject.
      queueResult([{ academicStatus: AcademicStatus.ENROLLED, tcIssued: true }]);
      // Main update .returning() → one row updated.
      queueResult([{ id: 'student-1' }]);
      // applyUserProfileUpdates: no user-profile fields in input → no select runs.
      // findById select → rows.
      queueResult([
        {
          id: 'student-1',
          academicStatus: AcademicStatus.TRANSFERRED_OUT,
          version: 2,
        },
      ]);

      await service.update('student-1', {
        version: 1,
        academicStatus: AcademicStatus.TRANSFERRED_OUT,
        tcNumber: 'TC-001',
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        'STUDENT.left',
        expect.objectContaining({
          studentProfileId: 'student-1',
          reason: AcademicStatus.TRANSFERRED_OUT,
          tcNumber: 'TC-001',
          tenantId: 'tenant-1',
        }),
      );
    });

    it('does NOT emit STUDENT.left for a non-departure status change', async () => {
      queueResult([{ academicStatus: AcademicStatus.ENROLLED, tcIssued: false }]);
      queueResult([{ id: 'student-1' }]);
      queueResult([{ id: 'student-1', academicStatus: AcademicStatus.GRADUATED, version: 2 }]);

      await service.update('student-1', {
        version: 1,
        academicStatus: AcademicStatus.GRADUATED,
      });

      expect(eventBus.emit).not.toHaveBeenCalledWith('STUDENT.left', expect.anything());
    });
  });

  describe('statistics', () => {
    it('aggregates totals, byStatus, bySection, byStandard, byGender, byCategory', async () => {
      // Six sequential SELECTs in withTenant — queue in order.
      queueResult([{ total: 42 }]);
      queueResult([
        { status: 'enrolled', count: 30 },
        { status: 'graduated', count: 12 },
      ]);
      queueResult([{ sectionId: 'sec-1', count: 20 }]);
      queueResult([{ standardId: 'std-1', count: 25 }]);
      queueResult([
        { gender: 'male', count: 22 },
        { gender: null, count: 2 },
      ]);
      queueResult([{ category: 'general', count: 40 }]);

      const { mkInstituteCtx } = await import('@roviq/database');
      const result = await readRepository.statistics({
        user: mkInstituteCtx('tenant-1', 'test:student-statistics'),
        ability: createMongoAbility<AppAbility>([{ action: 'manage', subject: 'all' }]),
      });

      expect(result.total).toBe(42);
      expect(result.byStatus).toEqual([
        { status: 'enrolled', count: 30 },
        { status: 'graduated', count: 12 },
      ]);
      expect(result.bySection).toEqual([{ sectionId: 'sec-1', count: 20 }]);
      expect(result.byStandard).toEqual([{ standardId: 'std-1', count: 25 }]);
      // Null gender is normalized to 'unknown'.
      expect(result.byGender).toEqual([
        { gender: 'male', count: 22 },
        { gender: 'unknown', count: 2 },
      ]);
      expect(result.byCategory).toEqual([{ category: 'general', count: 40 }]);
    });
  });

  describe('deleteDocument', () => {
    const admin = createMongoAbility<AppAbility>([{ action: 'manage', subject: 'all' }]);
    const noAadhaar = createMongoAbility<AppAbility>([
      { action: 'manage', subject: 'Student' },
      { action: 'read', subject: 'Student', fields: ['aadhaar'], inverted: true },
    ]);

    async function removeMock() {
      const { removeUserDocument } = await import('../../../files/user-document-files');
      return vi.mocked(removeUserDocument);
    }

    it('rejects with STUDENT_NOT_FOUND when the caller cannot reach the document', async () => {
      queueResult([]);
      const remove = await removeMock();

      await expect(service.deleteDocument('doc-1', admin)).rejects.toMatchObject({
        code: ErrorCode.STUDENT_NOT_FOUND,
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it('rejects an Aadhaar document for a caller without the aadhaar field, with STUDENT_NOT_FOUND', async () => {
      queueResult([{ type: 'AADHAAR_CARD' }]);
      const remove = await removeMock();

      await expect(service.deleteDocument('doc-1', noAadhaar)).rejects.toMatchObject({
        code: ErrorCode.STUDENT_NOT_FOUND,
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it('rejects with STUDENT_NOT_FOUND when the document was removed meanwhile', async () => {
      queueResult([{ type: 'BIRTH_CERTIFICATE' }]);
      const remove = await removeMock();
      remove.mockResolvedValueOnce(false);

      await expect(service.deleteDocument('doc-1', admin)).rejects.toMatchObject({
        code: ErrorCode.STUDENT_NOT_FOUND,
      });
    });

    it('removes another document type for a caller without the aadhaar field', async () => {
      queueResult([{ type: 'BIRTH_CERTIFICATE' }]);
      const remove = await removeMock();
      remove.mockResolvedValueOnce(true);

      await expect(service.deleteDocument('doc-1', noAadhaar)).resolves.toBe(true);
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it('removes the document as admin for the acting user, once', async () => {
      queueResult([{ type: 'AADHAAR_CARD' }]);
      const remove = await removeMock();
      remove.mockResolvedValueOnce(true);
      const { withAdmin } = await import('@roviq/database');

      await expect(service.deleteDocument('doc-1', admin)).resolves.toBe(true);

      expect(withAdmin).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove.mock.calls[0][1]).toEqual({ documentId: 'doc-1', actorId: 'user-1' });
      // No event: EVENT_PATTERNS has no student-document group; the mutation is audited instead.
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });
});
