/**
 * Compliance exports (ROV-296) through the real stack: GraphQL → guards → service →
 * repository → RLS. Temporal is replaced by a recorder; the workflow itself is covered by
 * compliance-export-activities.integration.spec.ts.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@roviq/common-types';
import {
  academicYears,
  exportReports,
  exportReportsLive,
  instituteAffiliations,
  mkAdminCtx,
  mkInstituteCtx,
  SYSTEM_USER_ID,
  withAdmin,
  withTenant,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  RESELLER_DIRECT_ID,
  type TestInstitute,
} from '@roviq/testing/integration';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';
import { TemporalClientService } from '../../../common/temporal/temporal-client.service';
import {
  COMPLIANCE_EXPORT_EXECUTION_TIMEOUT_MS,
  COMPLIANCE_EXPORT_STALE_AFTER_MS,
} from '../workflows/compliance-export.types';

const ORIGIN = 'test:compliance-export';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

interface ExportNode {
  id: string;
  tenantId: string;
  reportType: string;
  status: string;
  academicYearId: string;
  academicYearLabel: string | null;
  rowCount: number | null;
  errorCode: string | null;
  requestedBy: string;
  requesterFirstName: Record<string, string> | null;
  file: { id: string } | null;
}

const FIELDS =
  'id tenantId reportType status academicYearId academicYearLabel rowCount errorCode requestedBy requesterFirstName file { id }';

const ADMIN_EXPORT = `mutation AdminExport($input: AdminExportComplianceReportInput!) {
  adminExportComplianceReport(input: $input) { ${FIELDS} }
}`;
const ADMIN_LIST = `query AdminList($instituteId: ID!) {
  adminListExportReports(instituteId: $instituteId) { ${FIELDS} }
}`;
const INSTITUTE_EXPORT = `mutation Export($input: ExportComplianceReportInput!) {
  exportComplianceReport(input: $input) { ${FIELDS} }
}`;
const INSTITUTE_LIST = `query { listExportReports { ${FIELDS} } }`;

describe('Compliance exports (integration)', () => {
  let result: IntegrationAppResult;
  let instituteA: TestInstitute;
  let instituteB: TestInstitute;
  let yearA: string;
  let yearB: string;
  const startWorkflow = vi.fn<TemporalClientService['startWorkflow']>();

  const platformToken = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });
  const resellerToken = createResellerToken({
    sub: SEED_IDS.USER_RESELLER,
    resellerId: RESELLER_DIRECT_ID,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_RESELLER_FULL_ADMIN,
  });
  let instituteAToken: string;

  const gql = <T>(query: string, variables: Record<string, unknown>, token: string) =>
    gqlRequest<T>(result.httpServer, { query, variables, token });

  async function createYear(tenantId: string, label: string): Promise<string> {
    return withAdmin(result.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [year] = await tx
        .insert(academicYears)
        .values({ tenantId, label, startDate: '2025-04-01', endDate: '2026-03-31', ...BY })
        .returning({ id: academicYears.id });
      assert(year);
      return year.id;
    });
  }

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        {
          provide: TemporalClientService,
          useValue: createMock<TemporalClientService>({ startWorkflow }),
        },
      ],
    });
    const run = randomUUID().slice(0, 6);
    instituteA = await createTestInstitute(result.db, { slugSuffix: `${run}a` });
    instituteB = await createTestInstitute(result.db, { slugSuffix: `${run}b` });
    yearA = await createYear(instituteA.tenantId, '2025-26');
    yearB = await createYear(instituteB.tenantId, '2025-26');
    await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.insert(instituteAffiliations).values({
        tenantId: instituteB.tenantId,
        board: 'BSEH',
        affiliationStatus: 'REGULAR',
        validFrom: '2024-04-01',
        validTo: '2030-03-31',
        ...BY,
      }),
    );
    instituteAToken = createInstituteToken({
      sub: instituteA.userId,
      tenantId: instituteA.tenantId,
      membershipId: instituteA.membershipId,
      roleId: instituteA.roleId,
    });
  });

  beforeEach(() => {
    startWorkflow.mockReset();
    startWorkflow.mockResolvedValue('run-id');
  });

  afterAll(async () => {
    if (!result) return;
    const tenantIds = [instituteA?.tenantId, instituteB?.tenantId].filter(
      (id): id is string => typeof id === 'string',
    );
    await withAdmin(result.db, mkAdminCtx(ORIGIN), async (tx) => {
      await tx.delete(exportReports).where(inArray(exportReports.tenantId, tenantIds));
      await tx
        .delete(instituteAffiliations)
        .where(inArray(instituteAffiliations.tenantId, tenantIds));
      await tx.delete(academicYears).where(inArray(academicYears.tenantId, tenantIds));
    });
    if (instituteA) await cleanupTestInstitute(result.db, instituteA);
    if (instituteB) await cleanupTestInstitute(result.db, instituteB);
    await result.close();
  });

  async function adminExport(
    instituteId: string,
    academicYearId: string,
    reportType = 'UDISE_DCF',
  ) {
    return gql<{ adminExportComplianceReport: ExportNode }>(
      ADMIN_EXPORT,
      { input: { instituteId, reportType, academicYearId } },
      platformToken,
    );
  }

  async function insertExport(values: {
    tenantId: string;
    academicYearId: string;
    status: 'PENDING' | 'RUNNING';
    requestedAt: Date;
  }): Promise<string> {
    return withAdmin(result.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .insert(exportReports)
        .values({
          ...values,
          reportType: 'AWR',
          workflowId: `test-${randomUUID()}`,
          requestedBy: SEED_IDS.USER_ADMIN,
          ...BY,
        })
        .returning({ id: exportReports.id });
      assert(row);
      return row.id;
    });
  }

  async function exportRow(id: string) {
    const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.select().from(exportReports).where(eq(exportReports.id, id)),
    );
    assert(row);
    return row;
  }

  it('should boot with every Temporal worker switched off, whatever .env says', () => {
    const config = result.module.get(ConfigService);

    expect(config.get('COMPLIANCE_EXPORT_WORKER_ENABLED')).toBe('false');
    expect(config.get('FILE_SWEEPER_WORKER_ENABLED')).toBe('false');
  });

  describe('adminExportComplianceReport', () => {
    it('should create a PENDING export of the institute and start its workflow', async () => {
      const { data, errors } = await adminExport(instituteA.tenantId, yearA);

      expect(errors).toBeUndefined();
      const report = data?.adminExportComplianceReport;
      assert(report);
      expect(report).toEqual({
        id: report.id,
        tenantId: instituteA.tenantId,
        reportType: 'UDISE_DCF',
        status: 'PENDING',
        academicYearId: yearA,
        academicYearLabel: '2025-26',
        rowCount: null,
        errorCode: null,
        requestedBy: SEED_IDS.USER_ADMIN,
        requesterFirstName: report.requesterFirstName,
        file: null,
      });

      const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx.select().from(exportReports).where(eq(exportReports.id, report.id)),
      );
      assert(row);
      expect(row.status).toBe('PENDING');
      const [workflowType, options] = startWorkflow.mock.calls[0] ?? [];
      const fileId = (options?.args?.[0] as { fileId?: string } | undefined)?.fileId;
      assert(fileId);
      // Reserved by the database's uuidv7(), so a retried activity overwrites one object.
      expect(fileId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(workflowType).toBe('ComplianceExportWorkflow');
      expect(options).toEqual({
        taskQueue: 'compliance-export',
        workflowId: row.workflowId,
        workflowExecutionTimeout: COMPLIANCE_EXPORT_EXECUTION_TIMEOUT_MS,
        args: [
          {
            exportReportId: report.id,
            tenantId: instituteA.tenantId,
            reportType: 'UDISE_DCF',
            academicYearId: yearA,
            requestedBy: SEED_IDS.USER_ADMIN,
            fileId,
            fileName: `${instituteA.slug}-UDISE_DCF-2025-26.xlsx`,
          },
        ],
      });
    });

    it('should refuse an academic year that belongs to another institute', async () => {
      const { data, errors } = await adminExport(instituteA.tenantId, yearB);

      expect(data).toBeNull();
      expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.ACADEMIC_YEAR_NOT_FOUND);
      expect(startWorkflow).not.toHaveBeenCalled();
    });

    it('should refuse an institute that does not exist', async () => {
      const { errors } = await adminExport(randomUUID(), yearA);

      expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.INSTITUTE_NOT_FOUND);
    });

    it('should mark the export FAILED with EXPORT_START_FAILED when the workflow cannot start', async () => {
      startWorkflow.mockRejectedValue(new Error('temporal unavailable'));

      const { errors } = await adminExport(instituteA.tenantId, yearA);

      expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.EXPORT_START_FAILED);
      const rows = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({ status: exportReports.status, errorCode: exportReports.errorCode })
          .from(exportReports)
          .where(eq(exportReports.workflowId, String(startWorkflow.mock.calls[0]?.[1].workflowId))),
      );
      expect(rows).toEqual([{ status: 'FAILED', errorCode: ErrorCode.EXPORT_START_FAILED }]);
    });

    it('should refuse a board export the institute does not qualify for, creating no row', async () => {
      const before = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({ id: exportReports.id })
          .from(exportReports)
          .where(eq(exportReports.tenantId, instituteB.tenantId)),
      );

      const { errors } = await adminExport(instituteB.tenantId, yearB, 'CBSE_LOC');

      expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.EXPORT_TYPE_NOT_AVAILABLE);
      expect(startWorkflow).not.toHaveBeenCalled();
      const after = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({ id: exportReports.id })
          .from(exportReports)
          .where(eq(exportReports.tenantId, instituteB.tenantId)),
      );
      expect(after).toEqual(before);
    });

    it('should allow the BSEH staff statement for a BSEH-affiliated institute', async () => {
      const { data, errors } = await adminExport(
        instituteB.tenantId,
        yearB,
        'BSEH_STAFF_STATEMENT',
      );

      expect(errors).toBeUndefined();
      expect(data?.adminExportComplianceReport.status).toBe('PENDING');
    });

    it.each([
      ['reseller', () => resellerToken],
      ['institute', () => instituteAToken],
    ])('should reject a %s token', async (_scope, token) => {
      const { errors } = await gql(
        ADMIN_EXPORT,
        {
          input: {
            instituteId: instituteA.tenantId,
            reportType: 'UDISE_DCF',
            academicYearId: yearA,
          },
        },
        token(),
      );

      expect(errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(startWorkflow).not.toHaveBeenCalled();
    });
  });

  describe('adminListExportReports', () => {
    it('should list the institute’s exports newest first and nothing of other institutes', async () => {
      await adminExport(instituteB.tenantId, yearB);
      const first = await adminExport(instituteA.tenantId, yearA);
      const second = await adminExport(instituteA.tenantId, yearA);

      const { data, errors } = await gql<{ adminListExportReports: ExportNode[] }>(
        ADMIN_LIST,
        { instituteId: instituteA.tenantId },
        platformToken,
      );

      expect(errors).toBeUndefined();
      const list = data?.adminListExportReports ?? [];
      expect(list.every((r) => r.tenantId === instituteA.tenantId)).toBe(true);
      const ids = list.map((r) => r.id);
      const secondId = second.data?.adminExportComplianceReport.id;
      const firstId = first.data?.adminExportComplianceReport.id;
      assert(secondId && firstId);
      expect(ids.indexOf(secondId)).toBeLessThan(ids.indexOf(firstId));
    });

    it('should mark an export lost past the workflow timeout FAILED with EXPORT_TIMED_OUT', async () => {
      const lost = await insertExport({
        tenantId: instituteA.tenantId,
        academicYearId: yearA,
        status: 'RUNNING',
        requestedAt: new Date(Date.now() - COMPLIANCE_EXPORT_STALE_AFTER_MS - 60_000),
      });
      const fresh = await insertExport({
        tenantId: instituteA.tenantId,
        academicYearId: yearA,
        status: 'RUNNING',
        requestedAt: new Date(),
      });

      const { data, errors } = await gql<{ adminListExportReports: ExportNode[] }>(
        ADMIN_LIST,
        { instituteId: instituteA.tenantId },
        platformToken,
      );

      expect(errors).toBeUndefined();
      const byId = new Map((data?.adminListExportReports ?? []).map((r) => [r.id, r]));
      expect(byId.get(lost)).toMatchObject({ status: 'FAILED', errorCode: 'EXPORT_TIMED_OUT' });
      expect(byId.get(fresh)).toMatchObject({ status: 'RUNNING', errorCode: null });
      const lostRow = await exportRow(lost);
      expect(lostRow.version).toBe(2);
      expect(lostRow.completedAt).toBeInstanceOf(Date);
      expect((await exportRow(fresh)).version).toBe(1);
    });

    it.each([
      ['reseller', () => resellerToken],
      ['institute', () => instituteAToken],
    ])('should reject a %s token', async (_scope, token) => {
      const { errors } = await gql(ADMIN_LIST, { instituteId: instituteA.tenantId }, token());

      expect(errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });

  describe('institute scope', () => {
    it('should create an export of the caller’s own institute and list it', async () => {
      const created = await gql<{ exportComplianceReport: ExportNode }>(
        INSTITUTE_EXPORT,
        { input: { reportType: 'RTE_REPORT', academicYearId: yearA } },
        instituteAToken,
      );
      expect(created.errors).toBeUndefined();
      const report = created.data?.exportComplianceReport;
      assert(report);
      expect(report.tenantId).toBe(instituteA.tenantId);
      expect(report.status).toBe('PENDING');
      expect(report.requestedBy).toBe(instituteA.userId);

      const listed = await gql<{ listExportReports: ExportNode[] }>(
        INSTITUTE_LIST,
        {},
        instituteAToken,
      );
      expect(listed.errors).toBeUndefined();
      expect(listed.data?.listExportReports.map((r) => r.id)).toContain(report.id);
    });

    it('should refuse an academic year of another institute', async () => {
      const { errors } = await gql(
        INSTITUTE_EXPORT,
        { input: { reportType: 'AWR', academicYearId: yearB } },
        instituteAToken,
      );

      expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.ACADEMIC_YEAR_NOT_FOUND);
    });

    it('should refuse a report type the institute does not qualify for, creating no row', async () => {
      const { data, errors } = await gql(
        INSTITUTE_EXPORT,
        { input: { reportType: 'SHALA_DARPAN', academicYearId: yearA } },
        instituteAToken,
      );

      expect(data).toBeNull();
      expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.EXPORT_TYPE_NOT_AVAILABLE);
      expect(startWorkflow).not.toHaveBeenCalled();
      const rows = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({ id: exportReports.id })
          .from(exportReports)
          .where(
            and(
              eq(exportReports.tenantId, instituteA.tenantId),
              eq(exportReports.reportType, 'SHALA_DARPAN'),
            ),
          ),
      );
      expect(rows).toEqual([]);
    });

    it('should mark a lost export FAILED when the institute lists its exports', async () => {
      const lost = await insertExport({
        tenantId: instituteA.tenantId,
        academicYearId: yearA,
        status: 'PENDING',
        requestedAt: new Date(Date.now() - COMPLIANCE_EXPORT_STALE_AFTER_MS - 60_000),
      });

      const { data } = await gql<{ listExportReports: ExportNode[] }>(
        INSTITUTE_LIST,
        {},
        instituteAToken,
      );

      expect(data?.listExportReports.find((r) => r.id === lost)).toMatchObject({
        status: 'FAILED',
        errorCode: 'EXPORT_TIMED_OUT',
      });
    });

    it('should never show another institute’s exports', async () => {
      const other = await adminExport(instituteB.tenantId, yearB);
      const otherId = other.data?.adminExportComplianceReport.id;
      assert(otherId);

      const { data } = await gql<{ listExportReports: ExportNode[] }>(
        INSTITUTE_LIST,
        {},
        instituteAToken,
      );

      expect(data?.listExportReports.map((r) => r.id)).not.toContain(otherId);
      expect(data?.listExportReports.every((r) => r.tenantId === instituteA.tenantId)).toBe(true);
    });
  });

  describe('RLS as roviq_app', () => {
    it('should neither read nor change another institute’s export_reports rows', async () => {
      const other = await adminExport(instituteB.tenantId, yearB);
      const otherId = other.data?.adminExportComplianceReport.id;
      assert(otherId);

      const asA = mkInstituteCtx(instituteA.tenantId, ORIGIN);
      const read = await withTenant(result.db, asA, (tx) =>
        tx
          .select({ id: exportReportsLive.id })
          .from(exportReportsLive)
          .where(eq(exportReportsLive.id, otherId)),
      );
      const updated = await withTenant(result.db, asA, (tx) =>
        tx
          .update(exportReports)
          .set({ status: 'RUNNING' })
          .where(eq(exportReports.id, otherId))
          .returning({ id: exportReports.id }),
      );

      expect(read).toEqual([]);
      expect(updated).toEqual([]);
      const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({ status: exportReports.status })
          .from(exportReports)
          .where(eq(exportReports.id, otherId)),
      );
      expect(row?.status).toBe('PENDING');
    });

    it('should refuse to insert a row for another institute', async () => {
      const asA = mkInstituteCtx(instituteA.tenantId, ORIGIN);

      await expect(
        withTenant(result.db, asA, (tx) =>
          tx.insert(exportReports).values({
            tenantId: instituteB.tenantId,
            reportType: 'AWR',
            academicYearId: yearB,
            workflowId: `test-${randomUUID()}`,
            requestedBy: instituteA.userId,
            createdBy: instituteA.userId,
            updatedBy: instituteA.userId,
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    });
  });

  describe('database rules', () => {
    it('should refuse, even as roviq_admin, an export pointing at another institute’s academic year', async () => {
      await expect(
        withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
          tx.insert(exportReports).values({
            tenantId: instituteA.tenantId,
            reportType: 'AWR',
            academicYearId: yearB,
            workflowId: `test-${randomUUID()}`,
            requestedBy: SEED_IDS.USER_ADMIN,
            ...BY,
          }),
        ),
      ).rejects.toMatchObject({
        cause: { code: '23503', constraint: 'export_reports_academic_year_tenant_fkey' },
      });
    });
  });
});
