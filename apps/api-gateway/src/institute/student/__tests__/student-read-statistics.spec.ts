/**
 * StudentReadRepository.statistics (moved from student.service.spec.ts): the ability's field
 * rules and the null-gender label, against a fake transaction that answers from a result queue.
 */

import { createMongoAbility } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import type { DrizzleDB } from '@roviq/database';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentReadRepository } from '../student-read.repository';

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
// Hoisted: the mock factories below run before the static import of the repository.
const col = vi.hoisted(() => new Proxy({}, { get: () => 'col' }));

vi.mock('@roviq/database', () => ({
  DRIZZLE_DB: Symbol('DRIZZLE_DB'),
  withAdmin: vi.fn(mockWithContext),
  withTenant: vi.fn(mockWithContext),
  studentProfiles: col,
  studentAcademics: col,
  userProfiles: col,
  tenantUserProfiles: col,
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
  tenantUserProfilesLive: { __tableName: 'tenantUserProfilesLive' },
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
  loadUserDocumentFiles: vi.fn(),
}));

let readRepository: StudentReadRepository;

describe('StudentReadRepository.statistics (unit)', () => {
  beforeEach(() => {
    resetQueue();
    readRepository = new StudentReadRepository(createMock<DrizzleDB>());
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
});
