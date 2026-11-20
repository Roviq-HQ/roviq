/**
 * ComplianceExportWorkflow's activities against real PostgreSQL, in the order the workflow
 * runs them: a finished export ends COMPLETED with a READY XLSX file and its row count; a
 * generator that throws leaves the export FAILED with an error code and no READY file.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  academicYears,
  createDrizzleDb,
  type DrizzleDB,
  exportReports,
  files,
  mkAdminCtx,
  mkInstituteCtx,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import type { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient } from '@roviq/storage';
import {
  cleanupTestInstitute,
  createTestInstitute,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { WorkflowFileStore } from '../../../files/workflow-file-store';
import { generateBsehStaffStatementExport } from '../exports/bseh-staff-statement.export';
import { generateShalaDarpanExport } from '../exports/shala-darpan.export';
import { ExportReportDrizzleRepository } from '../repositories/export-report.drizzle-repository';
import {
  COMPLIANCE_EXPORT_GENERATORS,
  type ComplianceExportGenerator,
  createComplianceExportActivities,
} from '../workflows/compliance-export.activities';
import type { ComplianceExportInput } from '../workflows/compliance-export.types';

const hasTestDb = !!process.env.DATABASE_URL_TEST;
const ORIGIN = 'test:compliance-export-activities';

function workbook(rows: number): Buffer {
  const wb = XLSX.utils.book_new();
  const data = Array.from({ length: rows }, (_, i) => ({ 'S.No.': i + 1, Name: `Row ${i + 1}` }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe.skipIf(!hasTestDb)('Compliance export activities (integration)', () => {
  let pool: Pool;
  let db: DrizzleDB;
  let institute: TestInstitute;
  let yearId: string;
  let storage: FakeStorageClient;
  let repo: ExportReportDrizzleRepository;
  const emit = vi.fn<EventBusService['emit']>();

  function activities(generator: ComplianceExportGenerator) {
    return createComplianceExportActivities({
      db,
      repo,
      fileStore: new WorkflowFileStore(db, storage),
      eventBus: { emit },
      generators: { ...COMPLIANCE_EXPORT_GENERATORS, AWR: generator },
      logger: { log: vi.fn(), warn: vi.fn() },
    });
  }

  async function newExport(): Promise<ComplianceExportInput> {
    const { report, fileId } = await repo.create(mkInstituteCtx(institute.tenantId, ORIGIN), {
      tenantId: institute.tenantId,
      reportType: 'AWR',
      academicYearId: yearId,
      workflowId: `test-${randomUUID()}`,
      requestedBy: institute.userId,
    });
    return {
      exportReportId: report.id,
      tenantId: institute.tenantId,
      reportType: 'AWR',
      academicYearId: yearId,
      requestedBy: institute.userId,
      fileId,
      fileName: 'TEST-AWR-2025-26.xlsx',
    };
  }

  async function exportRow(id: string) {
    const [row] = await withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
      tx.select().from(exportReports).where(eq(exportReports.id, id)),
    );
    assert(row);
    return row;
  }

  async function fileRow(id: string) {
    const [row] = await withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
      tx.select().from(files).where(eq(files.id, id)),
    );
    return row ?? null;
  }

  beforeAll(async () => {
    assert(process.env.DATABASE_URL_TEST);
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 5 });
    db = createDrizzleDb(pool);
    repo = new ExportReportDrizzleRepository(db);
    institute = await createTestInstitute(db);
    yearId = await withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
      const [year] = await tx
        .insert(academicYears)
        .values({
          tenantId: institute.tenantId,
          label: '2025-26',
          startDate: '2025-04-01',
          endDate: '2026-03-31',
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: academicYears.id });
      assert(year);
      return year.id;
    });
  });

  beforeEach(() => {
    storage = new FakeStorageClient();
    emit.mockReset();
  });

  afterAll(async () => {
    if (institute) {
      await withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
        await tx.delete(exportReports).where(eq(exportReports.tenantId, institute.tenantId));
        await tx.delete(files).where(eq(files.tenantId, institute.tenantId));
        await tx.delete(academicYears).where(eq(academicYears.tenantId, institute.tenantId));
      });
      await cleanupTestInstitute(db, institute);
    }
    await pool?.end();
  });

  it('should end COMPLETED with a READY XLSX file and the generator’s row count', async () => {
    const input = await newExport();
    const { fileId } = input;
    const run = activities(
      vi.fn<ComplianceExportGenerator>().mockResolvedValue({
        buffer: workbook(3),
        rowCount: 3,
      }),
    );

    await run.markExportRunning(input);
    const generated = await run.generateExportFile(input);
    await run.markExportCompleted({ ...input, rowCount: generated.rowCount });

    const report = await exportRow(input.exportReportId);
    expect(report.status).toBe('COMPLETED');
    expect(report.fileId).toBe(fileId);
    expect(report.rowCount).toBe(3);
    expect(report.completedAt).toBeInstanceOf(Date);
    expect(report.errorCode).toBeNull();
    expect(report.version).toBe(3);

    const file = await fileRow(fileId);
    assert(file);
    expect(file.status).toBe('READY');
    expect(file.purpose).toBe('COMPLIANCE_EXPORT');
    expect(file.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(file.sizeBytes).toBe(generated.sizeBytes);
    expect(file.uploadedBy).toBe(institute.userId);
    expect(file.originalName).toBe('TEST-AWR-2025-26.xlsx');
    const stored = await storage.get('private', file.objectKey);
    expect(XLSX.read(stored).SheetNames).toEqual(['Data']);
  });

  it('should overwrite the same file when the generate step is retried', async () => {
    const input = await newExport();
    const { fileId } = input;
    const generator = vi
      .fn<ComplianceExportGenerator>()
      .mockResolvedValueOnce({ buffer: workbook(1), rowCount: 1 })
      .mockResolvedValueOnce({ buffer: workbook(40), rowCount: 40 });
    const run = activities(generator);

    await run.markExportRunning(input);
    await run.generateExportFile(input);
    const retried = await run.generateExportFile(input);

    const pending = await fileRow(fileId);
    assert(pending);
    expect(pending.status).toBe('PENDING');
    expect(pending.sizeBytes).toBe(retried.sizeBytes);
    const rows = await withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ id: files.id })
        .from(files)
        .where(inArray(files.id, [fileId])),
    );
    expect(rows).toHaveLength(1);
  });

  it('should leave a FAILED export with an error code and no READY file when the generator throws', async () => {
    const input = await newExport();
    const { fileId } = input;
    const run = activities(
      vi.fn<ComplianceExportGenerator>().mockRejectedValue(new Error('relation does not exist')),
    );

    await run.markExportRunning(input);
    await expect(run.generateExportFile(input)).rejects.toThrow('relation does not exist');
    // What the workflow does once Temporal has given up retrying the activity.
    await run.markExportFailed({ ...input, failureType: 'Error' });

    const report = await exportRow(input.exportReportId);
    expect(report.status).toBe('FAILED');
    expect(report.errorCode).toBe(ErrorCode.EXPORT_GENERATION_FAILED);
    expect(report.fileId).toBeNull();
    expect(report.completedAt).toBeInstanceOf(Date);
    expect(await fileRow(fileId)).toBeNull();
  });

  it('should refuse to complete an export that already FAILED', async () => {
    const input = await newExport();
    const { fileId } = input;
    const run = activities(
      vi.fn<ComplianceExportGenerator>().mockResolvedValue({ buffer: workbook(2), rowCount: 2 }),
    );
    await run.markExportRunning(input);
    await run.generateExportFile(input);
    await run.markExportFailed({ ...input, failureType: null });

    await expect(run.markExportCompleted({ ...input, rowCount: 2 })).rejects.toMatchObject({
      type: ErrorCode.INVALID_STATE_TRANSITION,
    });

    expect((await exportRow(input.exportReportId)).status).toBe('FAILED');
    expect((await fileRow(fileId))?.status).toBe('PENDING');
  });

  it.each([
    ['BSEH staff statement', generateBsehStaffStatementExport],
    ['Shala Darpan', generateShalaDarpanExport],
  ])('should run the %s generator against the real schema as the institute', async (_name, generate) => {
    const output = await generate(db, institute.tenantId, yearId);

    expect(output.rowCount).toBe(0);
    expect(XLSX.read(output.buffer).SheetNames.length).toBeGreaterThan(1);
  });
});
