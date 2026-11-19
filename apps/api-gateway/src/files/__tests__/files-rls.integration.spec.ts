/**
 * Database-level rules for stored files, tried as each role: RLS on `files`, its owner CHECK,
 * the one-record-per-file index on `leave_files`, and the attach guard used inside domain
 * transactions.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  createDrizzleDb,
  type DrizzleDB,
  files,
  leaveFiles,
  leaves,
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  SYSTEM_USER_ID,
  withAdmin,
  withReseller,
  withTenant,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  createTestInstitute,
  createTestReseller,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markFilesReady } from '../file-attachment';

const hasTestDb = !!process.env.DATABASE_URL_TEST;
const ORIGIN = 'test:files-rls';

describe.skipIf(!hasTestDb)('files — database rules', () => {
  let pool: Pool;
  let db: DrizzleDB;
  let owningReseller: TestReseller;
  let otherReseller: TestReseller;
  let tenantA: TestInstitute;
  let tenantB: TestInstitute;
  let fileA: string;

  function fileValues(tenantId: string, uploadedBy: string) {
    return {
      tenantId,
      visibility: 'PRIVATE' as const,
      purpose: 'LEAVE_ATTACHMENT' as const,
      objectKey: `institutes/${tenantId}/leave-attachment/${randomUUID()}.pdf`,
      originalName: 'certificate.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      uploadedBy,
      createdBy: uploadedBy,
      updatedBy: uploadedBy,
    };
  }

  async function insertFile(tenant: TestInstitute, uploadedBy = tenant.userId): Promise<string> {
    return withTenant(db, mkInstituteCtx(tenant.tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .insert(files)
        .values(fileValues(tenant.tenantId, uploadedBy))
        .returning({ id: files.id });
      assert(row);
      return row.id;
    });
  }

  async function insertLeave(tenant: TestInstitute): Promise<string> {
    return withTenant(db, mkInstituteCtx(tenant.tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .insert(leaves)
        .values({
          tenantId: tenant.tenantId,
          userId: tenant.membershipId,
          startDate: '2026-12-01',
          endDate: '2026-12-01',
          type: 'CASUAL',
          reason: 'files rls test',
          createdBy: tenant.userId,
          updatedBy: tenant.userId,
        })
        .returning({ id: leaves.id });
      assert(row);
      return row.id;
    });
  }

  beforeAll(async () => {
    assert(process.env.DATABASE_URL_TEST);
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 5 });
    db = createDrizzleDb(pool);
    owningReseller = await createTestReseller(db);
    otherReseller = await createTestReseller(db);
    tenantA = await createTestInstitute(db, { resellerId: owningReseller.resellerId });
    tenantB = await createTestInstitute(db, { resellerId: otherReseller.resellerId });
    fileA = await insertFile(tenantA);
  });

  afterAll(async () => {
    if (!db) return;
    const tenantIds = [tenantA.tenantId, tenantB.tenantId];
    await withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
      await tx.delete(leaveFiles).where(inArray(leaveFiles.tenantId, tenantIds));
      await tx.delete(leaves).where(inArray(leaves.tenantId, tenantIds));
      await tx.delete(files).where(inArray(files.tenantId, tenantIds));
    });
    await cleanupTestInstitute(db, tenantA);
    await cleanupTestInstitute(db, tenantB);
    await cleanupTestReseller(db, owningReseller);
    await cleanupTestReseller(db, otherReseller);
    await pool.end();
  });

  describe('institute role (roviq_app)', () => {
    it('should read its own file', async () => {
      const rows = await withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
        tx.select({ id: files.id }).from(files).where(eq(files.id, fileA)),
      );

      expect(rows).toEqual([{ id: fileA }]);
    });

    it("should not read another institute's file", async () => {
      const rows = await withTenant(db, mkInstituteCtx(tenantB.tenantId, ORIGIN), (tx) =>
        tx.select({ id: files.id }).from(files).where(eq(files.id, fileA)),
      );

      expect(rows).toEqual([]);
    });

    it("should not update another institute's file", async () => {
      const updated = await withTenant(db, mkInstituteCtx(tenantB.tenantId, ORIGIN), (tx) =>
        tx
          .update(files)
          .set({ status: 'READY', updatedBy: tenantB.userId })
          .where(eq(files.id, fileA))
          .returning({ id: files.id }),
      );

      expect(updated).toEqual([]);
    });

    it('should not insert a file owned by another institute', async () => {
      await expect(
        withTenant(db, mkInstituteCtx(tenantB.tenantId, ORIGIN), (tx) =>
          tx.insert(files).values(fileValues(tenantA.tenantId, tenantB.userId)),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    });

    it('should not hard-delete even its own file', async () => {
      const deleted = await withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
        tx.delete(files).where(eq(files.id, fileA)).returning({ id: files.id }),
      );

      expect(deleted).toEqual([]);
    });
  });

  describe('reseller role (roviq_reseller)', () => {
    it("should read a file of one of its institutes and not of another reseller's", async () => {
      const own = await withReseller(db, mkResellerCtx(owningReseller.resellerId, ORIGIN), (tx) =>
        tx.select({ id: files.id }).from(files).where(eq(files.id, fileA)),
      );
      const foreign = await withReseller(
        db,
        mkResellerCtx(otherReseller.resellerId, ORIGIN),
        (tx) => tx.select({ id: files.id }).from(files).where(eq(files.id, fileA)),
      );

      expect(own).toEqual([{ id: fileA }]);
      expect(foreign).toEqual([]);
    });

    it('should not be able to write files at all', async () => {
      await expect(
        withReseller(db, mkResellerCtx(owningReseller.resellerId, ORIGIN), (tx) =>
          tx.insert(files).values(fileValues(tenantA.tenantId, owningReseller.userId)),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    });
  });

  describe('owner CHECK', () => {
    it('should refuse a file with no owner', async () => {
      await expect(
        withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
          tx.insert(files).values({
            ...fileValues(tenantA.tenantId, SYSTEM_USER_ID),
            tenantId: null,
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'chk_files_owner' } });
    });

    it('should refuse a file owned by both an institute and a reseller', async () => {
      await expect(
        withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
          tx.insert(files).values({
            ...fileValues(tenantA.tenantId, SYSTEM_USER_ID),
            resellerId: owningReseller.resellerId,
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'chk_files_owner' } });
    });
  });

  describe('markFilesReady', () => {
    it('should make a pending upload of the same user and purpose ready', async () => {
      const fileId = await insertFile(tenantA);

      await withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
        markFilesReady(tx, {
          fileIds: [fileId],
          purpose: 'LEAVE_ATTACHMENT',
          userId: tenantA.userId,
        }),
      );

      const [row] = await withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
        tx.select({ status: files.status }).from(files).where(eq(files.id, fileId)),
      );
      expect(row).toEqual({ status: 'READY' });
    });

    it.each([
      ['uploaded by someone else', () => ({ userId: tenantB.userId })],
      ['uploaded for another purpose', () => ({ purpose: 'BULK_IMPORT_CSV' as const })],
    ])('should refuse a file %s', async (_label, override) => {
      const fileId = await insertFile(tenantA);

      await expect(
        withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
          markFilesReady(tx, {
            fileIds: [fileId],
            purpose: 'LEAVE_ATTACHMENT',
            userId: tenantA.userId,
            ...override(),
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_NOT_FOUND });
    });

    it('should refuse a file that is already attached', async () => {
      const fileId = await insertFile(tenantA);
      const attach = () =>
        withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
          markFilesReady(tx, {
            fileIds: [fileId],
            purpose: 'LEAVE_ATTACHMENT',
            userId: tenantA.userId,
          }),
        );
      await attach();

      await expect(attach()).rejects.toMatchObject({ code: ErrorCode.FILE_NOT_FOUND });
    });

    it("should refuse another institute's file even with the right user id", async () => {
      await expect(
        withTenant(db, mkInstituteCtx(tenantB.tenantId, ORIGIN), (tx) =>
          markFilesReady(tx, {
            fileIds: [fileA],
            purpose: 'LEAVE_ATTACHMENT',
            userId: tenantA.userId,
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_NOT_FOUND });
    });
  });

  describe('leave_files', () => {
    it('should refuse to attach one file to two leaves', async () => {
      const fileId = await insertFile(tenantA);
      const firstLeave = await insertLeave(tenantA);
      const secondLeave = await insertLeave(tenantA);
      const link = (leaveId: string) =>
        withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
          tx.insert(leaveFiles).values({
            tenantId: tenantA.tenantId,
            leaveId,
            fileId,
            createdBy: tenantA.userId,
            updatedBy: tenantA.userId,
          }),
        );
      await link(firstLeave);

      await expect(link(secondLeave)).rejects.toMatchObject({
        cause: { code: '23505', constraint: 'leave_files_file_id_key' },
      });
    });
  });
});
