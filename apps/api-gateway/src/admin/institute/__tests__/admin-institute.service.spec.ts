import { ConfigService } from '@nestjs/config';
import { ErrorCode, ResellerStatus } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstituteService } from '../../../institute/management/institute.service';
import { InstituteRepository } from '../../../institute/management/repositories/institute.repository';
import type { InstituteRecord } from '../../../institute/management/repositories/types';
import { AdminInstituteService } from '../admin-institute.service';
import { AdminInstituteRepository } from '../repositories/admin-institute.repository';

// ── Temporal mock — fire-and-forget path just logs the warning ────────────────

vi.mock('@temporalio/client', () => ({
  Connection: { connect: vi.fn().mockRejectedValue(new Error('temporal unavailable')) },
  Client: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INSTITUTE_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const RESELLER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const GROUP_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const NEW_RESELLER_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

function makeInstituteRecord(overrides: Partial<InstituteRecord> = {}): InstituteRecord {
  return {
    id: INSTITUTE_ID,
    name: { en: 'Test Institute' },
    slug: 'test-institute',
    code: 'TI001',
    type: 'SCHOOL',
    structureFramework: 'CBSE',
    setupStatus: 'COMPLETED',
    contact: {
      phones: [
        {
          countryCode: '+91',
          number: '9000000000',
          isPrimary: true,
          isWhatsappEnabled: false,
          label: 'Primary',
        },
      ],
      emails: [{ address: 'admin@test.com', isPrimary: true, label: 'Primary' }],
    },
    address: null,
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    settings: {},
    supportedLocales: ['en'],
    defaultLocale: 'en',
    status: 'ACTIVE',
    resellerId: RESELLER_ID,
    groupId: null,
    departments: ['PRIMARY'],
    isDemo: false,
    firstAdminUserId: 'aaaaaaaa-0000-7000-a000-000000000001',
    version: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe('AdminInstituteService', () => {
  let service: AdminInstituteService;
  let instituteService: InstituteService;
  let instituteRepo: InstituteRepository;
  let eventBus: EventBusService;
  let configService: ConfigService;
  let adminRepo: AdminInstituteRepository;

  beforeEach(() => {
    instituteService = createMock<InstituteService>({
      findById: vi.fn().mockResolvedValue(makeInstituteRecord()),
    });
    instituteRepo = createMock<InstituteRepository>({
      search: vi.fn().mockResolvedValue({ records: [], total: 0 }),
      updateStatus: vi.fn().mockResolvedValue(makeInstituteRecord()),
      updateOwnership: vi.fn().mockResolvedValue(makeInstituteRecord()),
      statistics: vi.fn().mockResolvedValue({
        totalInstitutes: 0,
        byStatus: [],
        byType: [],
        byReseller: [],
        recentlyCreated: 0,
      }),
    });
    eventBus = createMock<EventBusService>({ emit: vi.fn() });
    configService = createMock<ConfigService>({
      get: vi.fn().mockReturnValue('localhost:7233'),
    });

    adminRepo = createMock<AdminInstituteRepository>({
      findReseller: vi.fn().mockResolvedValue(null),
      instituteGroupExists: vi.fn().mockResolvedValue(false),
      findAcademicTreeRows: vi.fn().mockResolvedValue({ academicYearId: null }),
      findPrimaryBoard: vi.fn().mockResolvedValue(undefined),
    });

    service = new AdminInstituteService(
      instituteService,
      instituteRepo,
      eventBus,
      configService,
      adminRepo,
    );
  });

  // ── reassignReseller ────────────────────────────────────────────────────────

  describe('reassignReseller', () => {
    it('throws RESELLER_INVALID when target reseller is not found', async () => {
      vi.mocked(adminRepo.findReseller).mockResolvedValue(null);

      await expect(service.reassignReseller(INSTITUTE_ID, NEW_RESELLER_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_INVALID,
      });
      expect(instituteRepo.updateOwnership).not.toHaveBeenCalled();
    });

    it('throws RESELLER_INVALID when target reseller is not active', async () => {
      vi.mocked(adminRepo.findReseller).mockResolvedValue({
        id: NEW_RESELLER_ID,
        status: ResellerStatus.SUSPENDED,
        isActive: false,
      });

      await expect(service.reassignReseller(INSTITUTE_ID, NEW_RESELLER_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_INVALID,
      });
      expect(instituteRepo.updateOwnership).not.toHaveBeenCalled();
    });

    it('throws RESELLER_INVALID when reseller status is ACTIVE but isActive=false', async () => {
      vi.mocked(adminRepo.findReseller).mockResolvedValue({
        id: NEW_RESELLER_ID,
        status: ResellerStatus.ACTIVE,
        isActive: false,
      });

      await expect(service.reassignReseller(INSTITUTE_ID, NEW_RESELLER_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_INVALID,
      });
    });

    it('updates ownership and emits INSTITUTE.reseller_reassigned on success', async () => {
      vi.mocked(adminRepo.findReseller).mockResolvedValue({
        id: NEW_RESELLER_ID,
        status: ResellerStatus.ACTIVE,
        isActive: true,
      });

      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ resellerId: RESELLER_ID }),
      );
      const updated = makeInstituteRecord({ resellerId: NEW_RESELLER_ID });
      vi.mocked(instituteRepo.updateOwnership).mockResolvedValue(updated);

      const result = await service.reassignReseller(INSTITUTE_ID, NEW_RESELLER_ID);

      expect(instituteRepo.updateOwnership).toHaveBeenCalledWith(INSTITUTE_ID, {
        resellerId: NEW_RESELLER_ID,
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'INSTITUTE.reseller_reassigned',
        expect.objectContaining({
          previousResellerId: RESELLER_ID,
          newResellerId: NEW_RESELLER_ID,
        }),
      );
      expect(result.resellerId).toBe(NEW_RESELLER_ID);
    });
  });

  // ── assignGroup ─────────────────────────────────────────────────────────────

  describe('assignGroup', () => {
    it('rejects when group does not exist', async () => {
      vi.mocked(adminRepo.instituteGroupExists).mockResolvedValue(false);

      await expect(service.assignGroup(INSTITUTE_ID, GROUP_ID)).rejects.toMatchObject({
        code: ErrorCode.INSTITUTE_GROUP_NOT_FOUND,
      });
      expect(instituteRepo.updateOwnership).not.toHaveBeenCalled();
    });

    it('assigns group and emits INSTITUTE.group_assigned', async () => {
      vi.mocked(adminRepo.instituteGroupExists).mockResolvedValue(true);

      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ groupId: null }),
      );
      const updated = makeInstituteRecord({ groupId: GROUP_ID });
      vi.mocked(instituteRepo.updateOwnership).mockResolvedValue(updated);

      const result = await service.assignGroup(INSTITUTE_ID, GROUP_ID);

      expect(instituteRepo.updateOwnership).toHaveBeenCalledWith(INSTITUTE_ID, {
        groupId: GROUP_ID,
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'INSTITUTE.group_assigned',
        expect.objectContaining({
          previousGroupId: null,
          newGroupId: GROUP_ID,
        }),
      );
      expect(result.groupId).toBe(GROUP_ID);
    });

    it('carries previous groupId in the event when reassigning between groups', async () => {
      const OLD_GROUP = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
      vi.mocked(adminRepo.instituteGroupExists).mockResolvedValue(true);

      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ groupId: OLD_GROUP }),
      );
      vi.mocked(instituteRepo.updateOwnership).mockResolvedValue(
        makeInstituteRecord({ groupId: GROUP_ID }),
      );

      await service.assignGroup(INSTITUTE_ID, GROUP_ID);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'INSTITUTE.group_assigned',
        expect.objectContaining({ previousGroupId: OLD_GROUP, newGroupId: GROUP_ID }),
      );
    });
  });

  // ── removeGroup ─────────────────────────────────────────────────────────────

  describe('removeGroup', () => {
    it('sets groupId to null and emits INSTITUTE.group_removed', async () => {
      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ groupId: GROUP_ID }),
      );
      const updated = makeInstituteRecord({ groupId: null });
      vi.mocked(instituteRepo.updateOwnership).mockResolvedValue(updated);

      const result = await service.removeGroup(INSTITUTE_ID);

      expect(instituteRepo.updateOwnership).toHaveBeenCalledWith(INSTITUTE_ID, { groupId: null });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'INSTITUTE.group_removed',
        expect.objectContaining({ previousGroupId: GROUP_ID }),
      );
      expect(result.groupId).toBeNull();
    });
  });

  // ── retrySetup ──────────────────────────────────────────────────────────────

  describe('retrySetup', () => {
    it('throws SETUP_NOT_COMPLETE (idempotency) when setup is already COMPLETED', async () => {
      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ setupStatus: 'COMPLETED' }),
      );

      await expect(service.retrySetup(INSTITUTE_ID)).rejects.toMatchObject({
        code: ErrorCode.SETUP_NOT_COMPLETE,
      });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('triggers workflow (fire-and-forget) and emits INSTITUTE.setup_retry_triggered when setupStatus is not COMPLETED', async () => {
      vi.mocked(adminRepo.findPrimaryBoard).mockResolvedValue(undefined);

      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ setupStatus: 'FAILED' }),
      );

      const result = await service.retrySetup(INSTITUTE_ID);

      expect(eventBus.emit).toHaveBeenCalledWith('INSTITUTE.setup_retry_triggered', {
        instituteId: INSTITUTE_ID,
        tenantId: INSTITUTE_ID,
      });
      expect(result.id).toBe(INSTITUTE_ID);
    });

    it('still resolves even if Temporal is unreachable', async () => {
      vi.mocked(adminRepo.findPrimaryBoard).mockResolvedValue(undefined);

      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ setupStatus: 'IN_PROGRESS' }),
      );

      // Should not throw even though Connection.connect is mocked to reject
      await expect(service.retrySetup(INSTITUTE_ID)).resolves.toBeDefined();
    });
  });

  // ── approve ─────────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('throws SETUP_NOT_COMPLETE when status is not PENDING_APPROVAL', async () => {
      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ status: 'ACTIVE' }),
      );

      await expect(service.approve(INSTITUTE_ID)).rejects.toMatchObject({
        code: ErrorCode.SETUP_NOT_COMPLETE,
      });
      expect(instituteRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('transitions to PENDING, emits approved + status_changed', async () => {
      vi.mocked(adminRepo.findPrimaryBoard).mockResolvedValue(undefined);

      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ status: 'PENDING_APPROVAL' }),
      );
      const updated = makeInstituteRecord({ status: 'PENDING' });
      vi.mocked(instituteRepo.updateStatus).mockResolvedValue(updated);

      const result = await service.approve(INSTITUTE_ID);

      expect(instituteRepo.updateStatus).toHaveBeenCalledWith(INSTITUTE_ID, 'PENDING');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'INSTITUTE.approved',
        expect.objectContaining({ id: INSTITUTE_ID }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'INSTITUTE.status_changed',
        expect.objectContaining({ previousStatus: 'PENDING_APPROVAL', newStatus: 'PENDING' }),
      );
      expect(result.status).toBe('PENDING');
    });
  });

  // ── reject ──────────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('throws SETUP_NOT_COMPLETE when status is ACTIVE', async () => {
      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ status: 'ACTIVE' }),
      );

      await expect(service.reject(INSTITUTE_ID, 'incomplete docs')).rejects.toMatchObject({
        code: ErrorCode.SETUP_NOT_COMPLETE,
      });
    });

    it('rejects from PENDING_APPROVAL and emits rejected + status_changed', async () => {
      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ status: 'PENDING_APPROVAL' }),
      );
      const updated = makeInstituteRecord({ status: 'REJECTED' });
      vi.mocked(instituteRepo.updateStatus).mockResolvedValue(updated);

      await service.reject(INSTITUTE_ID, 'docs not valid');

      expect(instituteRepo.updateStatus).toHaveBeenCalledWith(INSTITUTE_ID, 'REJECTED');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'INSTITUTE.rejected',
        expect.objectContaining({ reason: 'docs not valid' }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'INSTITUTE.status_changed',
        expect.objectContaining({
          previousStatus: 'PENDING_APPROVAL',
          newStatus: 'REJECTED',
        }),
      );
    });

    it('rejects from PENDING status as well', async () => {
      vi.mocked(instituteService.findById).mockResolvedValue(
        makeInstituteRecord({ status: 'PENDING' }),
      );
      vi.mocked(instituteRepo.updateStatus).mockResolvedValue(
        makeInstituteRecord({ status: 'REJECTED' }),
      );

      await service.reject(INSTITUTE_ID, 'wrong affiliation');

      expect(instituteRepo.updateStatus).toHaveBeenCalledWith(INSTITUTE_ID, 'REJECTED');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'INSTITUTE.status_changed',
        expect.objectContaining({ previousStatus: 'PENDING', newStatus: 'REJECTED' }),
      );
    });
  });

  // ── getAcademicTree ─────────────────────────────────────────────────────────

  describe('getAcademicTree', () => {
    it('returns empty standards list when no academic year exists', async () => {
      vi.mocked(adminRepo.findAcademicTreeRows).mockResolvedValue({ academicYearId: null });

      const tree = await service.getAcademicTree(INSTITUTE_ID);

      expect(tree.instituteId).toBe(INSTITUTE_ID);
      expect(tree.academicYearId).toBeNull();
      expect(tree.standards).toEqual([]);
    });

    it('returns tree with standards, sections, and subjects when academic year exists', async () => {
      const YEAR_ID = 'y1111111-1111-4111-1111-111111111111';
      const STD_ID = 's2222222-2222-4222-2222-222222222222';
      const SEC_ID = 'e3333333-3333-4333-3333-333333333333';
      const SUBJ_ID = 'u4444444-4444-4444-4444-444444444444';

      vi.mocked(adminRepo.findAcademicTreeRows).mockResolvedValue({
        academicYearId: YEAR_ID,
        standards: [
          { id: STD_ID, name: { en: 'Class 5' }, numericOrder: 5, department: 'PRIMARY' },
        ],
        sections: [{ id: SEC_ID, name: { en: 'A' }, stream: null, standardId: STD_ID }],
        standardSubjects: [{ subjectId: SUBJ_ID, standardId: STD_ID }],
        subjects: [
          {
            id: SUBJ_ID,
            name: 'Mathematics',
            shortName: 'Math',
            boardCode: 'CBSE-041',
            type: 'ACADEMIC',
          },
        ],
      });

      const tree = await service.getAcademicTree(INSTITUTE_ID);

      expect(tree.academicYearId).toBe(YEAR_ID);
      expect(tree.standards).toHaveLength(1);

      const [std] = tree.standards;
      expect(std.id).toBe(STD_ID);
      expect(std.department).toBe('PRIMARY');
      expect(std.sections).toHaveLength(1);
      expect(std.sections[0].id).toBe(SEC_ID);
      expect(std.subjects).toHaveLength(1);
      expect(std.subjects[0].id).toBe(SUBJ_ID);
      expect(std.subjects[0].name).toBe('Mathematics');
    });

    it('skips subject links that point to missing subject rows', async () => {
      const YEAR_ID = 'y1111111-1111-4111-1111-111111111111';
      const STD_ID = 's2222222-2222-4222-2222-222222222222';
      const MISSING_SUBJ = 'missing-subject-id';

      vi.mocked(adminRepo.findAcademicTreeRows).mockResolvedValue({
        academicYearId: YEAR_ID,
        standards: [{ id: STD_ID, name: { en: 'Class 1' }, numericOrder: 1, department: null }],
        sections: [],
        standardSubjects: [{ subjectId: MISSING_SUBJ, standardId: STD_ID }],
        subjects: [], // subject row is gone
      });

      const tree = await service.getAcademicTree(INSTITUTE_ID);

      expect(tree.standards[0].subjects).toHaveLength(0);
    });
  });

  // ── list ────────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns relay-style connection with hasNextPage=false when fewer than first+1 rows', async () => {
      const records = [makeInstituteRecord()];
      vi.mocked(instituteRepo.search).mockResolvedValue({ records, total: 1 });

      const result = await service.list({ first: 20 });

      expect(result.edges).toHaveLength(1);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.totalCount).toBe(1);
    });

    it('signals hasNextPage=true and slices to first when repo returns first+1 rows', async () => {
      const records = Array.from({ length: 21 }, (_, i) =>
        makeInstituteRecord({ id: `${`${i}`.padStart(8, '0')}-0000-4000-a000-000000000000` }),
      );
      vi.mocked(instituteRepo.search).mockResolvedValue({ records, total: 100 });

      const result = await service.list({ first: 20 });

      expect(result.edges).toHaveLength(20);
      expect(result.pageInfo.hasNextPage).toBe(true);
    });

    it('passes filter fields through to repository search', async () => {
      vi.mocked(instituteRepo.search).mockResolvedValue({ records: [], total: 0 });

      await service.list({
        search: 'test',
        status: ['ACTIVE'],
        resellerId: RESELLER_ID,
        groupId: GROUP_ID,
        first: 10,
        after: 'cursor123',
      });

      expect(instituteRepo.search).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'test',
          statuses: ['ACTIVE'],
          resellerId: RESELLER_ID,
          groupId: GROUP_ID,
          first: 11, // limit + 1
          after: 'cursor123',
        }),
      );
    });
  });
});
