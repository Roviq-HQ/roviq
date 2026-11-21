/**
 * Compliance exports (ROV-296) through the real stack, Temporal worker included
 * (`COMPLIANCE_EXPORT_WORKER_ENABLED` in docker/compose.e2e.yaml): a platform admin asks for a
 * UDISE+ export, the workflow builds and stores it, and the signed link serves the XLSX.
 *
 * Cross-scope rejection, cross-institute RLS and the academic-year check are covered by
 * `compliance-export.integration.spec.ts`; the activities by
 * `compliance-export-activities.integration.spec.ts`.
 */
import assert from 'node:assert';
import { ComplianceReportType, ErrorCode } from '@roviq/common-types';
import { beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { SEED_IDS } from '../../shared/seed-fixtures';
import { loginAsInstituteAdmin, loginAsPlatformAdmin } from './helpers/auth';
import { gql } from './helpers/gql-client';

interface ExportNode {
  id: string;
  tenantId: string;
  reportType: string;
  status: string;
  rowCount: number | null;
  errorCode: string | null;
  file: { id: string; contentType: string; sizeBytes: number; url: string | null } | null;
}

const FIELDS =
  'id tenantId reportType status rowCount errorCode file { id contentType sizeBytes url }';
const ADMIN_EXPORT = `mutation AdminExport($input: AdminExportComplianceReportInput!) {
  adminExportComplianceReport(input: $input) { ${FIELDS} }
}`;
const ADMIN_LIST = `query AdminList($instituteId: ID!) {
  adminListExportReports(instituteId: $instituteId) { ${FIELDS} }
}`;
const ADMIN_DOWNLOAD = `mutation Download($fileId: ID!) {
  adminExportReportDownloadUrl(fileId: $fileId)
}`;
const INSTITUTE_DOWNLOAD = `mutation Download($fileId: ID!) { fileDownloadUrl(fileId: $fileId) }`;

const EXPORT_TIMEOUT_MS = 60_000;

describe('Compliance export E2E', () => {
  let adminToken: string;

  async function waitForFinish(exportId: string): Promise<ExportNode> {
    const deadline = Date.now() + EXPORT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const res = await gql<{ adminListExportReports: ExportNode[] }>(
        ADMIN_LIST,
        { instituteId: SEED_IDS.INSTITUTE_1 },
        adminToken,
      );
      expect(res.errors).toBeUndefined();
      const report = res.data?.adminListExportReports.find((r) => r.id === exportId);
      if (report?.status === 'COMPLETED' || report?.status === 'FAILED') return report;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Export ${exportId} did not finish within ${EXPORT_TIMEOUT_MS} ms`);
  }

  beforeAll(async () => {
    ({ accessToken: adminToken } = await loginAsPlatformAdmin());
  });

  describe('a UDISE+ export of the seeded institute', () => {
    let finished: ExportNode;

    it(
      'should go from PENDING to COMPLETED with a row count and a private file',
      async () => {
        const started = await gql<{ adminExportComplianceReport: ExportNode }>(
          ADMIN_EXPORT,
          {
            input: {
              instituteId: SEED_IDS.INSTITUTE_1,
              reportType: ComplianceReportType.UDISE_DCF,
              academicYearId: SEED_IDS.ACADEMIC_YEAR_INST1,
            },
          },
          adminToken,
        );
        expect(started.errors).toBeUndefined();
        const report = started.data?.adminExportComplianceReport;
        assert(report);
        expect(report).toMatchObject({
          tenantId: SEED_IDS.INSTITUTE_1,
          reportType: ComplianceReportType.UDISE_DCF,
          status: 'PENDING',
          file: null,
        });

        finished = await waitForFinish(report.id);

        expect(finished.status).toBe('COMPLETED');
        expect(finished.errorCode).toBeNull();
        expect(finished.rowCount).toBeGreaterThan(0);
        assert(finished.file);
        expect(finished.file.contentType).toBe(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        // Sensitive: never a link in a list, only through the audited download mutation.
        expect(finished.file.url).toBeNull();
      },
      EXPORT_TIMEOUT_MS + 10_000,
    );

    it('should serve a non-empty XLSX with the UDISE+ sheets through the signed link', async () => {
      assert(finished.file);
      const link = await gql<{ adminExportReportDownloadUrl: string }>(
        ADMIN_DOWNLOAD,
        { fileId: finished.file.id },
        adminToken,
      );
      expect(link.errors).toBeUndefined();
      const url = link.data?.adminExportReportDownloadUrl;
      assert(url);

      const response = await fetch(url);
      expect(response.status).toBe(200);
      const body = Buffer.from(await response.arrayBuffer());

      expect(body.length).toBe(finished.file.sizeBytes);
      expect(body.subarray(0, 2).toString()).toBe('PK');
      const book = XLSX.read(body);
      expect(book.SheetNames).toEqual(['Students', 'Teachers']);
    });

    it('should let the institute’s own admin download it with `fileDownloadUrl`', async () => {
      assert(finished.file);
      const { accessToken } = await loginAsInstituteAdmin();

      const link = await gql<{ fileDownloadUrl: string }>(
        INSTITUTE_DOWNLOAD,
        { fileId: finished.file.id },
        accessToken,
      );

      expect(link.errors).toBeUndefined();
      expect(link.data?.fileDownloadUrl).toMatch(/^https?:\/\//);
    });

    it('should not sign a link for a file that is not a finished export', async () => {
      const link = await gql(ADMIN_DOWNLOAD, { fileId: SEED_IDS.INSTITUTE_2 }, adminToken);

      expect(link.errors?.[0]?.extensions?.code).toBe(ErrorCode.EXPORT_REPORT_NOT_FOUND);
    });
  });
});
