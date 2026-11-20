/**
 * Database-level rules for stored files, tried as each role: RLS on `files`, its owner CHECK,
 * the one-record-per-file index on `leave_files`, the pages of user and application documents,
 * and the attach guard used inside domain transactions.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  academicYears,
  admissionApplications,
  applicationDocumentFiles,
  applicationDocumentFilesLive,
  applicationDocuments,
  createDrizzleDb,
  type DrizzleDB,
  files,
  leaveFiles,
  leaves,
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  SYSTEM_USER_ID,
  standards,
  userDocumentFiles,
  userDocumentFilesLive,
  userDocuments,
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
  const userLevelFileIds: string[] = [];
  const resellerFileIds: string[] = [];
  const documentIds: string[] = [];

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
      // Pages and documents go with their application (ON DELETE CASCADE).
      await tx
        .delete(admissionApplications)
        .where(inArray(admissionApplications.tenantId, tenantIds));
      await tx.delete(standards).where(inArray(standards.tenantId, tenantIds));
      await tx.delete(academicYears).where(inArray(academicYears.tenantId, tenantIds));
      await tx.delete(leaveFiles).where(inArray(leaveFiles.tenantId, tenantIds));
      await tx.delete(leaves).where(inArray(leaves.tenantId, tenantIds));
      await tx.delete(files).where(inArray(files.tenantId, tenantIds));
      const looseIds = [...userLevelFileIds, ...resellerFileIds];
      if (documentIds.length > 0) {
        // Its pages go with it (ON DELETE CASCADE).
        await tx.delete(userDocuments).where(inArray(userDocuments.id, documentIds));
      }
      if (looseIds.length > 0) await tx.delete(files).where(inArray(files.id, looseIds));
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

    const logoValues = (resellerId: string, uploadedBy: string) => ({
      resellerId,
      visibility: 'PUBLIC' as const,
      purpose: 'RESELLER_LOGO' as const,
      objectKey: `resellers/${resellerId}/reseller-logo/${randomUUID()}.png`,
      originalName: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 2048,
      uploadedBy,
      createdBy: uploadedBy,
      updatedBy: uploadedBy,
    });
    const asReseller = <T>(reseller: TestReseller, fn: Parameters<typeof withReseller<T>>[2]) =>
      withReseller(db, mkResellerCtx(reseller.resellerId, ORIGIN), fn);

    it('should not write a file of one of its institutes, only read it', async () => {
      await expect(
        asReseller(owningReseller, (tx) =>
          tx.insert(files).values(fileValues(tenantA.tenantId, owningReseller.userId)),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });

      const updated = await asReseller(owningReseller, (tx) =>
        tx
          .update(files)
          .set({ originalName: 'renamed.pdf' })
          .where(eq(files.id, fileA))
          .returning({ id: files.id }),
      );
      expect(updated).toEqual([]);
    });

    it('should store and change a file it owns itself', async () => {
      const [own] = await asReseller(owningReseller, (tx) =>
        tx
          .insert(files)
          .values(logoValues(owningReseller.resellerId, owningReseller.userId))
          .returning({ id: files.id }),
      );
      assert(own);
      resellerFileIds.push(own.id);

      const ready = await asReseller(owningReseller, (tx) =>
        tx
          .update(files)
          .set({ status: 'READY' })
          .where(eq(files.id, own.id))
          .returning({ id: files.id }),
      );
      expect(ready).toEqual([{ id: own.id }]);
    });

    it("should neither store a file under another reseller nor see or change that reseller's", async () => {
      await expect(
        asReseller(owningReseller, (tx) =>
          tx.insert(files).values(logoValues(otherReseller.resellerId, owningReseller.userId)),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });

      const [foreign] = await asReseller(otherReseller, (tx) =>
        tx
          .insert(files)
          .values(logoValues(otherReseller.resellerId, otherReseller.userId))
          .returning({ id: files.id }),
      );
      assert(foreign);
      resellerFileIds.push(foreign.id);

      const seen = await asReseller(owningReseller, (tx) =>
        tx.select({ id: files.id }).from(files).where(eq(files.id, foreign.id)),
      );
      const changed = await asReseller(owningReseller, (tx) =>
        tx
          .update(files)
          .set({ status: 'READY' })
          .where(eq(files.id, foreign.id))
          .returning({ id: files.id }),
      );
      expect(seen).toEqual([]);
      expect(changed).toEqual([]);
    });

    it("should not let an institute see or attach its reseller's file", async () => {
      const [logo] = await asReseller(owningReseller, (tx) =>
        tx
          .insert(files)
          .values(logoValues(owningReseller.resellerId, owningReseller.userId))
          .returning({ id: files.id }),
      );
      assert(logo);
      resellerFileIds.push(logo.id);

      const seen = await withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
        tx.select({ id: files.id }).from(files).where(eq(files.id, logo.id)),
      );
      expect(seen).toEqual([]);
    });

    it('should not hard-delete even its own file', async () => {
      const [own] = await asReseller(owningReseller, (tx) =>
        tx
          .insert(files)
          .values(logoValues(owningReseller.resellerId, owningReseller.userId))
          .returning({ id: files.id }),
      );
      assert(own);
      resellerFileIds.push(own.id);

      await expect(
        asReseller(owningReseller, (tx) => tx.delete(files).where(eq(files.id, own.id))),
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

  describe('files that belong to a person (profile pictures)', () => {
    function photoValues(subjectUserId: string, uploadedBy: string) {
      return {
        subjectUserId,
        visibility: 'PRIVATE' as const,
        purpose: 'PROFILE_PHOTO' as const,
        objectKey: `users/${subjectUserId}/profile-photo/${randomUUID()}.jpg`,
        originalName: 'me.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 2048,
        uploadedBy,
        createdBy: uploadedBy,
        updatedBy: uploadedBy,
      };
    }

    async function insertPhoto(tenant: TestInstitute, subjectUserId: string): Promise<string> {
      return withTenant(db, mkInstituteCtx(tenant.tenantId, ORIGIN), async (tx) => {
        const [row] = await tx
          .insert(files)
          .values(photoValues(subjectUserId, tenant.userId))
          .returning({ id: files.id });
        assert(row);
        userLevelFileIds.push(row.id);
        return row.id;
      });
    }

    it('should let an institute store and read a picture of its own member', async () => {
      const photoId = await insertPhoto(tenantA, tenantA.userId);

      const rows = await withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
        tx.select({ id: files.id }).from(files).where(eq(files.id, photoId)),
      );

      expect(rows).toEqual([{ id: photoId }]);
    });

    it('should hide the picture from an institute the person is not a member of', async () => {
      const photoId = await insertPhoto(tenantA, tenantA.userId);

      const rows = await withTenant(db, mkInstituteCtx(tenantB.tenantId, ORIGIN), (tx) =>
        tx.select({ id: files.id }).from(files).where(eq(files.id, photoId)),
      );

      expect(rows).toEqual([]);
    });

    it('should refuse an institute storing a picture of someone who is not its member', async () => {
      await expect(
        withTenant(db, mkInstituteCtx(tenantB.tenantId, ORIGIN), (tx) =>
          tx.insert(files).values(photoValues(tenantA.userId, tenantB.userId)),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    });

    it("should not let a non-member institute change the picture's row", async () => {
      const photoId = await insertPhoto(tenantA, tenantA.userId);

      const updated = await withTenant(db, mkInstituteCtx(tenantB.tenantId, ORIGIN), (tx) =>
        tx
          .update(files)
          .set({ status: 'DELETED', updatedBy: tenantB.userId })
          .where(eq(files.id, photoId))
          .returning({ id: files.id }),
      );

      expect(updated).toEqual([]);
    });

    it("should show the picture to the reseller of the member's institute only", async () => {
      const photoId = await insertPhoto(tenantA, tenantA.userId);
      const read = (reseller: TestReseller) =>
        withReseller(db, mkResellerCtx(reseller.resellerId, ORIGIN), (tx) =>
          tx.select({ id: files.id }).from(files).where(eq(files.id, photoId)),
        );

      expect(await read(owningReseller)).toEqual([{ id: photoId }]);
      expect(await read(otherReseller)).toEqual([]);
    });

    it('should refuse attaching a picture to a different person than it was uploaded for', async () => {
      const photoId = await insertPhoto(tenantA, tenantA.userId);

      await expect(
        withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
          markFilesReady(tx, {
            fileIds: [photoId],
            purpose: 'PROFILE_PHOTO',
            userId: tenantA.userId,
            subjectUserId: tenantB.userId,
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_NOT_FOUND });
    });
  });

  describe("user_document_files (pages of a person's document)", () => {
    async function insertDocumentFile(subjectUserId: string): Promise<string> {
      return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
        const [row] = await tx
          .insert(files)
          .values({
            subjectUserId,
            visibility: 'PRIVATE',
            purpose: 'USER_DOCUMENT',
            objectKey: `users/${subjectUserId}/user-document/${randomUUID()}.pdf`,
            originalName: 'birth-certificate.pdf',
            contentType: 'application/pdf',
            sizeBytes: 2048,
            status: 'READY',
            uploadedBy: SYSTEM_USER_ID,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })
          .returning({ id: files.id });
        assert(row);
        userLevelFileIds.push(row.id);
        return row.id;
      });
    }

    async function insertDocument(userId: string): Promise<string> {
      return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
        const [row] = await tx
          .insert(userDocuments)
          .values({
            userId,
            type: 'BIRTH_CERTIFICATE',
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })
          .returning({ id: userDocuments.id });
        assert(row);
        documentIds.push(row.id);
        return row.id;
      });
    }

    function pageValues(documentId: string, userId: string, fileId: string) {
      return {
        documentId,
        userId,
        fileId,
        position: 0,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      };
    }

    async function attachedPage(userId: string): Promise<{ documentId: string; fileId: string }> {
      const documentId = await insertDocument(userId);
      const fileId = await insertDocumentFile(userId);
      await withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
        tx.insert(userDocumentFiles).values(pageValues(documentId, userId, fileId)),
      );
      return { documentId, fileId };
    }

    const pagesSeenBy = (tenant: TestInstitute, documentId: string) =>
      withTenant(db, mkInstituteCtx(tenant.tenantId, ORIGIN), (tx) =>
        tx
          .select({ fileId: userDocumentFilesLive.fileId })
          .from(userDocumentFilesLive)
          .where(eq(userDocumentFilesLive.documentId, documentId)),
      );

    it("should show a document's pages to an institute the person is a member of", async () => {
      const { documentId, fileId } = await attachedPage(tenantA.userId);

      expect(await pagesSeenBy(tenantA, documentId)).toEqual([{ fileId }]);
    });

    it('should hide the pages from an institute the person is not a member of', async () => {
      const { documentId } = await attachedPage(tenantA.userId);

      expect(await pagesSeenBy(tenantB, documentId)).toEqual([]);
    });

    it('should refuse an institute role writing a page, even for its own member', async () => {
      const documentId = await insertDocument(tenantA.userId);
      const fileId = await insertDocumentFile(tenantA.userId);

      const attempt = withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
        tx.insert(userDocumentFiles).values(pageValues(documentId, tenantA.userId, fileId)),
      );

      await expect(attempt).rejects.toMatchObject({ cause: { code: '42501' } });
    });

    it('should refuse one file being a page of two documents', async () => {
      const { fileId } = await attachedPage(tenantA.userId);
      const second = await insertDocument(tenantA.userId);

      const attempt = withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
        tx.insert(userDocumentFiles).values(pageValues(second, tenantA.userId, fileId)),
      );

      await expect(attempt).rejects.toMatchObject({
        cause: { code: '23505', constraint: 'user_document_files_file_id_key' },
      });
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

  describe('application_document_files (pages of an admission application document)', () => {
    let applicationId: string;
    let documentId: string;
    let fileId: string;

    async function insertApplication(tenant: TestInstitute): Promise<string> {
      return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
        const audit = { createdBy: tenant.userId, updatedBy: tenant.userId };
        const [year] = await tx
          .insert(academicYears)
          .values({
            tenantId: tenant.tenantId,
            label: '2026-27',
            startDate: '2026-04-01',
            endDate: '2027-03-31',
            isActive: false,
            ...audit,
          })
          .returning({ id: academicYears.id });
        assert(year);
        const [standard] = await tx
          .insert(standards)
          .values({
            tenantId: tenant.tenantId,
            academicYearId: year.id,
            name: { en: `Class 1 ${randomUUID().slice(0, 8)}` },
            numericOrder: 1,
            level: 'PRIMARY',
            ...audit,
          })
          .returning({ id: standards.id });
        assert(standard);
        const [application] = await tx
          .insert(admissionApplications)
          .values({
            tenantId: tenant.tenantId,
            academicYearId: year.id,
            standardId: standard.id,
            formData: { studentName: 'Aarav Verma' },
            ...audit,
          })
          .returning({ id: admissionApplications.id });
        assert(application);
        return application.id;
      });
    }

    async function insertDocument(tenant: TestInstitute): Promise<string> {
      return withTenant(db, mkInstituteCtx(tenant.tenantId, ORIGIN), async (tx) => {
        const [document] = await tx
          .insert(applicationDocuments)
          .values({
            tenantId: tenant.tenantId,
            applicationId,
            type: 'BIRTH_CERTIFICATE',
            createdBy: tenant.userId,
            updatedBy: tenant.userId,
          })
          .returning({ id: applicationDocuments.id });
        assert(document);
        return document.id;
      });
    }

    const pageValues = (owner: TestInstitute, document: string, file: string) => ({
      tenantId: owner.tenantId,
      documentId: document,
      fileId: file,
      position: 0,
      createdBy: owner.userId,
      updatedBy: owner.userId,
    });

    const pagesSeenBy = (tenant: TestInstitute) =>
      withTenant(db, mkInstituteCtx(tenant.tenantId, ORIGIN), (tx) =>
        tx
          .select({ fileId: applicationDocumentFilesLive.fileId })
          .from(applicationDocumentFilesLive)
          .where(eq(applicationDocumentFilesLive.documentId, documentId)),
      );

    beforeAll(async () => {
      applicationId = await insertApplication(tenantA);
      documentId = await insertDocument(tenantA);
      fileId = await insertFile(tenantA);
      await withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
        tx.insert(applicationDocumentFiles).values(pageValues(tenantA, documentId, fileId)),
      );
    });

    it("should show a document's pages to the institute that owns the application", async () => {
      const pages = await pagesSeenBy(tenantA);

      expect(pages).toEqual([{ fileId }]);
    });

    it('should hide the pages from another institute', async () => {
      const pages = await pagesSeenBy(tenantB);

      expect(pages).toEqual([]);
    });

    it("should refuse an institute writing a page into another institute's document", async () => {
      const foreignFile = await insertFile(tenantB);

      const write = withTenant(db, mkInstituteCtx(tenantB.tenantId, ORIGIN), (tx) =>
        tx.insert(applicationDocumentFiles).values(pageValues(tenantA, documentId, foreignFile)),
      );

      await expect(write).rejects.toMatchObject({ cause: { code: '42501' } });
    });

    it('should refuse one file being a page of two documents', async () => {
      const second = await insertDocument(tenantA);

      const write = withTenant(db, mkInstituteCtx(tenantA.tenantId, ORIGIN), (tx) =>
        tx.insert(applicationDocumentFiles).values(pageValues(tenantA, second, fileId)),
      );

      await expect(write).rejects.toMatchObject({
        cause: { code: '23505', constraint: 'application_document_files_file_id_key' },
      });
    });
  });
});
