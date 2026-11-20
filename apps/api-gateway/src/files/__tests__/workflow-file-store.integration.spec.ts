/**
 * File access for Temporal activities against real PostgreSQL: what a workflow may read is
 * decided by the institute it names, and a retried write does not create a second file.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  createDrizzleDb,
  type DrizzleDB,
  files,
  mkAdminCtx,
  mkInstituteCtx,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { FakeStorageClient } from '@roviq/storage';
import {
  cleanupTestInstitute,
  createTestInstitute,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowFileStore } from '../workflow-file-store';

const hasTestDb = !!process.env.DATABASE_URL_TEST;
const ORIGIN = 'test:workflow-file-store';
const CSV = Buffer.from('first_name,gender\nArjun,male\n');

describe.skipIf(!hasTestDb)('WorkflowFileStore (integration)', () => {
  let pool: Pool;
  let db: DrizzleDB;
  let tenantA: TestInstitute;
  let tenantB: TestInstitute;
  let storage: FakeStorageClient;
  let store: WorkflowFileStore;

  async function insertCsv(
    tenant: TestInstitute,
    overrides: { status?: 'PENDING' | 'READY'; purpose?: 'BULK_IMPORT_CSV' | 'LEAVE_ATTACHMENT' },
  ): Promise<string> {
    const objectKey = `institutes/${tenant.tenantId}/bulk-import-csv/${randomUUID()}.csv`;
    await storage.put('private', objectKey, CSV, { contentType: 'text/csv' });
    return withTenant(db, mkInstituteCtx(tenant.tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({
          tenantId: tenant.tenantId,
          visibility: 'PRIVATE',
          purpose: overrides.purpose ?? 'BULK_IMPORT_CSV',
          objectKey,
          originalName: 'students.csv',
          contentType: 'text/csv',
          sizeBytes: CSV.length,
          status: overrides.status ?? 'READY',
          uploadedBy: tenant.userId,
          createdBy: tenant.userId,
          updatedBy: tenant.userId,
        })
        .returning({ id: files.id });
      assert(row);
      return row.id;
    });
  }

  beforeAll(async () => {
    assert(process.env.DATABASE_URL_TEST);
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 5 });
    db = createDrizzleDb(pool);
    tenantA = await createTestInstitute(db);
    tenantB = await createTestInstitute(db);
  });

  beforeEach(() => {
    storage = new FakeStorageClient();
    store = new WorkflowFileStore(db, storage);
  });

  afterAll(async () => {
    if (!db) return;
    await withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
      tx.delete(files).where(inArray(files.tenantId, [tenantA.tenantId, tenantB.tenantId])),
    );
    await cleanupTestInstitute(db, tenantA);
    await cleanupTestInstitute(db, tenantB);
    await pool.end();
  });

  describe('read', () => {
    it("should return the bytes of the institute's own ready file", async () => {
      const fileId = await insertCsv(tenantA, {});

      const body = await store.read(tenantA.tenantId, fileId, 'BULK_IMPORT_CSV');

      expect(body.equals(CSV)).toBe(true);
    });

    it("should refuse a workflow of one institute reading another institute's file", async () => {
      const fileId = await insertCsv(tenantA, {});

      await expect(store.read(tenantB.tenantId, fileId, 'BULK_IMPORT_CSV')).rejects.toThrow(
        'is not a ready BULK_IMPORT_CSV file of this institute',
      );
    });

    it('should refuse a file of another purpose', async () => {
      const fileId = await insertCsv(tenantA, { purpose: 'LEAVE_ATTACHMENT' });

      await expect(store.read(tenantA.tenantId, fileId, 'BULK_IMPORT_CSV')).rejects.toThrow(
        'is not a ready BULK_IMPORT_CSV file of this institute',
      );
    });

    it('should refuse an upload that was never verified', async () => {
      const fileId = await insertCsv(tenantA, { status: 'PENDING' });

      await expect(store.read(tenantA.tenantId, fileId, 'BULK_IMPORT_CSV')).rejects.toThrow(
        'is not a ready BULK_IMPORT_CSV file of this institute',
      );
    });
  });

  describe('put', () => {
    const report = (fileId: string, body: string) => ({
      tenantId: tenantA.tenantId,
      fileId,
      purpose: 'BULK_IMPORT_REPORT' as const,
      fileName: 'import-errors.csv',
      contentType: 'text/csv' as const,
      body: Buffer.from(body),
      createdBy: tenantA.userId,
    });

    const storedRows = (fileId: string) =>
      withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({
            tenantId: files.tenantId,
            purpose: files.purpose,
            status: files.status,
            objectKey: files.objectKey,
            sizeBytes: files.sizeBytes,
            uploadedBy: files.uploadedBy,
          })
          .from(files)
          .where(eq(files.id, fileId)),
      );

    it('should store the bytes and a ready row owned by the institute', async () => {
      const fileId = randomUUID();

      await store.put(report(fileId, 'row_number,field\n1,gender\n'));

      const objectKey = `institutes/${tenantA.tenantId}/bulk-import-report/${fileId}.csv`;
      expect(await storedRows(fileId)).toEqual([
        {
          tenantId: tenantA.tenantId,
          purpose: 'BULK_IMPORT_REPORT',
          status: 'READY',
          objectKey,
          sizeBytes: 26,
          uploadedBy: tenantA.userId,
        },
      ]);
      expect((await storage.get('private', objectKey)).toString()).toBe(
        'row_number,field\n1,gender\n',
      );
    });

    it('should keep one row when a retried activity writes the same file again', async () => {
      const fileId = randomUUID();
      await store.put(report(fileId, 'first attempt'));

      await store.put(report(fileId, 'first attempt'));

      expect(await storedRows(fileId)).toHaveLength(1);
    });

    it('should be readable back by the same institute only', async () => {
      const fileId = randomUUID();
      await store.put(report(fileId, 'private report'));

      const seenByOther = await withTenant(db, mkInstituteCtx(tenantB.tenantId, ORIGIN), (tx) =>
        tx.select({ id: files.id }).from(files).where(eq(files.id, fileId)),
      );

      expect(seenByOther).toEqual([]);
    });
  });
});
