/**
 * The file sweeper against real PostgreSQL (as roviq_admin) and an in-memory store: what is
 * removed when, what is never removed, and that objects go before rows.
 *
 * The test database is shared, and the sweeper works across every institute. So every row
 * here is dated around a fixed `NOW` in the year 2000 and each run is given that `NOW`: only
 * rows of this file are ever old enough for it to touch.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { FilePurpose, FileStatus, FileVisibility } from '@roviq/common-types';
import {
  createDrizzleDb,
  type DrizzleDB,
  files,
  instituteBranding,
  leaveFiles,
  leaves,
  mkAdminCtx,
  mkInstituteCtx,
  resellers,
  SYSTEM_USER_ID,
  staffProfiles,
  staffQualifications,
  userDocumentFiles,
  userDocuments,
  userProfiles,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { FakeStorageClient, type StorageBucket } from '@roviq/storage';
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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FilePurgeRepository,
  type PurgeCandidate,
  type SweepSelection,
} from '../file-purge.repository';
import { FileSweeper, type SweepCounts } from '../file-sweeper';
import { pendingKeyOf, storedKeysOf } from '../storage-keys';

const hasTestDb = !!process.env.DATABASE_URL_TEST;
const ORIGIN = 'test:file-sweeper';
const NOW = new Date('2000-06-01T00:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS);
const daysAgo = (days: number) => hoursAgo(days * 24);
const NONE: SweepCounts = { removed: 0, failed: 0, skipped: 0 };

interface Fixture {
  id: string;
  objectKey: string;
  visibility: FileVisibility;
}

interface FileOptions {
  status: FileStatus;
  purpose?: FilePurpose;
  image?: boolean;
  createdAt: Date;
  updatedAt?: Date;
  deletedAt?: Date;
}

const PUBLIC_PURPOSES: readonly FilePurpose[] = [
  'INSTITUTE_LOGO',
  'INSTITUTE_FAVICON',
  'INSTITUTE_COVER',
  'RESELLER_LOGO',
];

/** A store whose delete fails for chosen keys, like a storage outage for one object. */
class FlakyStorage extends FakeStorageClient {
  readonly failFor = new Set<string>();

  override async delete(bucket: StorageBucket, keys: string[]): Promise<void> {
    if (keys.some((key) => this.failFor.has(key))) throw new Error('storage unavailable');
    await super.delete(bucket, keys);
  }
}

/** Lets a test change the database between selection and the per-file routine. */
class RacingRepository extends FilePurgeRepository {
  onSelect: ((candidates: PurgeCandidate[]) => Promise<PurgeCandidate[]>) | null = null;

  override async findStale(
    selection: SweepSelection,
    now: Date,
    limit: number,
    skipIds: string[] = [],
  ): Promise<PurgeCandidate[]> {
    const found = await super.findStale(selection, now, limit, skipIds);
    const hook = this.onSelect;
    if (!hook || found.length === 0) return found;
    this.onSelect = null;
    return hook(found);
  }
}

describe.skipIf(!hasTestDb)('FileSweeper (integration)', () => {
  let pool: Pool;
  let db: DrizzleDB;
  let tenantA: TestInstitute;
  let tenantB: TestInstitute;
  let brandingId: string;
  let profileId: string;
  let reseller: TestReseller;
  let staffProfileId: string;
  let storage: FlakyStorage;
  let repo: RacingRepository;
  let sweeper: FileSweeper;
  let createdFileIds: string[];
  let createdLeaveIds: string[];
  let createdDocumentIds: string[];

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) => withAdmin(db, mkAdminCtx(ORIGIN), fn);

  async function insertFile(tenant: TestInstitute, options: FileOptions): Promise<Fixture> {
    const id = randomUUID();
    const purpose = options.purpose ?? 'LEAVE_ATTACHMENT';
    const visibility: FileVisibility = PUBLIC_PURPOSES.includes(purpose) ? 'PUBLIC' : 'PRIVATE';
    const contentType = options.image || visibility === 'PUBLIC' ? 'image/png' : 'application/pdf';
    const folder = purpose.toLowerCase().replaceAll('_', '-');
    const objectKey = `institutes/${tenant.tenantId}/${folder}/${id}.${contentType === 'image/png' ? 'png' : 'pdf'}`;
    await asAdmin((tx) =>
      tx.insert(files).values({
        id,
        tenantId: tenant.tenantId,
        visibility,
        purpose,
        objectKey,
        originalName: 'fixture',
        contentType,
        sizeBytes: 4,
        status: options.status,
        uploadedBy: tenant.userId,
        createdBy: tenant.userId,
        updatedBy: tenant.userId,
        createdAt: options.createdAt,
        updatedAt: options.updatedAt ?? options.createdAt,
        deletedAt: options.deletedAt ?? null,
        deletedBy: options.deletedAt ? tenant.userId : null,
      }),
    );
    createdFileIds.push(id);
    return { id, objectKey, visibility };
  }

  const bucketOf = (file: Fixture): StorageBucket =>
    file.visibility === 'PUBLIC' ? 'public' : 'private';

  /** The upload as the browser left it. */
  async function putPending(file: Fixture): Promise<void> {
    await storage.put('private', pendingKeyOf(file), Buffer.from('data'), {
      contentType: 'application/octet-stream',
    });
  }

  /** The original and all three image sizes in the file's own bucket. */
  async function putStored(file: Fixture): Promise<void> {
    for (const key of storedKeysOf(file)) {
      await storage.put(bucketOf(file), key, Buffer.from('data'), { contentType: 'image/webp' });
    }
  }

  const hasPending = (file: Fixture) => storage.has('private', pendingKeyOf(file));
  const storedLeft = (file: Fixture) =>
    storedKeysOf(file).filter((key) => storage.has(bucketOf(file), key));

  async function rowOf(fileId: string) {
    const [row] = await asAdmin((tx) =>
      tx
        .select({ status: files.status, deletedAt: files.deletedAt, deletedBy: files.deletedBy })
        .from(files)
        .where(eq(files.id, fileId)),
    );
    return row;
  }

  async function versionOf(fileId: string) {
    const [row] = await asAdmin((tx) =>
      tx
        .select({ status: files.status, updatedBy: files.updatedBy, version: files.version })
        .from(files)
        .where(eq(files.id, fileId)),
    );
    assert(row);
    return row;
  }

  async function linkToLeave(
    tenant: TestInstitute,
    fileId: string,
    linkDeleted: boolean,
  ): Promise<string> {
    return withTenant(db, mkInstituteCtx(tenant.tenantId, ORIGIN), async (tx) => {
      const [leave] = await tx
        .insert(leaves)
        .values({
          tenantId: tenant.tenantId,
          userId: tenant.membershipId,
          startDate: '2000-05-01',
          endDate: '2000-05-01',
          type: 'CASUAL',
          reason: 'file sweeper test',
          createdBy: tenant.userId,
          updatedBy: tenant.userId,
        })
        .returning({ id: leaves.id });
      assert(leave);
      createdLeaveIds.push(leave.id);
      const [link] = await tx
        .insert(leaveFiles)
        .values({
          tenantId: tenant.tenantId,
          leaveId: leave.id,
          fileId,
          createdBy: tenant.userId,
          updatedBy: tenant.userId,
          deletedAt: linkDeleted ? daysAgo(40) : null,
          deletedBy: linkDeleted ? tenant.userId : null,
        })
        .returning({ id: leaveFiles.id });
      assert(link);
      return link.id;
    });
  }

  /** A page of a person's document, written as roviq_admin like the real code does. */
  async function linkToUserDocument(fileId: string, pageDeleted: boolean): Promise<string> {
    return asAdmin(async (tx) => {
      const [document] = await tx
        .insert(userDocuments)
        .values({
          userId: tenantA.userId,
          type: 'BIRTH_CERTIFICATE',
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: userDocuments.id });
      assert(document);
      createdDocumentIds.push(document.id);
      const [page] = await tx
        .insert(userDocumentFiles)
        .values({
          documentId: document.id,
          userId: tenantA.userId,
          fileId,
          position: 0,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          deletedAt: pageDeleted ? daysAgo(40) : null,
          deletedBy: pageDeleted ? SYSTEM_USER_ID : null,
        })
        .returning({ id: userDocumentFiles.id });
      assert(page);
      return page.id;
    });
  }

  async function documentPageExists(pageId: string): Promise<boolean> {
    const rows = await asAdmin((tx) =>
      tx
        .select({ id: userDocumentFiles.id })
        .from(userDocumentFiles)
        .where(eq(userDocumentFiles.id, pageId)),
    );
    return rows.length > 0;
  }

  async function profilePhotoOf(): Promise<string | null | undefined> {
    const [row] = await asAdmin((tx) =>
      tx
        .select({ fileId: userProfiles.profileImageFileId })
        .from(userProfiles)
        .where(eq(userProfiles.id, profileId)),
    );
    return row?.fileId;
  }

  const pointProfileAt = (fileId: string) =>
    asAdmin((tx) =>
      tx
        .update(userProfiles)
        .set({ profileImageFileId: fileId })
        .where(eq(userProfiles.id, profileId)),
    );

  const pointResellerLogoAt = (fileId: string | null) =>
    asAdmin((tx) =>
      tx.update(resellers).set({ logoFileId: fileId }).where(eq(resellers.id, reseller.resellerId)),
    );

  async function resellerLogoOf(): Promise<string | null | undefined> {
    const [row] = await asAdmin((tx) =>
      tx
        .select({ fileId: resellers.logoFileId })
        .from(resellers)
        .where(eq(resellers.id, reseller.resellerId)),
    );
    return row?.fileId;
  }

  /** A qualification of the test staff member holding `fileId` as its certificate. */
  async function insertQualification(fileId: string, deleted: boolean): Promise<string> {
    const [row] = await asAdmin((tx) =>
      tx
        .insert(staffQualifications)
        .values({
          tenantId: tenantA.tenantId,
          staffProfileId,
          type: 'ACADEMIC',
          degreeName: 'B.Ed',
          certificateFileId: fileId,
          createdBy: tenantA.userId,
          updatedBy: tenantA.userId,
          deletedAt: deleted ? daysAgo(40) : null,
          deletedBy: deleted ? tenantA.userId : null,
        })
        .returning({ id: staffQualifications.id }),
    );
    assert(row);
    return row.id;
  }

  async function certificateOf(qualificationId: string): Promise<string | null | undefined> {
    const [row] = await asAdmin((tx) =>
      tx
        .select({ fileId: staffQualifications.certificateFileId })
        .from(staffQualifications)
        .where(eq(staffQualifications.id, qualificationId)),
    );
    return row?.fileId;
  }

  async function leaveLinkExists(linkId: string): Promise<boolean> {
    const rows = await asAdmin((tx) =>
      tx.select({ id: leaveFiles.id }).from(leaveFiles).where(eq(leaveFiles.id, linkId)),
    );
    return rows.length > 0;
  }

  async function pointBranding(column: 'logoFileId' | 'coverImageFileId', fileId: string | null) {
    await asAdmin((tx) =>
      tx
        .update(instituteBranding)
        .set({ [column]: fileId })
        .where(eq(instituteBranding.id, brandingId)),
    );
  }

  beforeAll(async () => {
    assert(process.env.DATABASE_URL_TEST);
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 5 });
    db = createDrizzleDb(pool);
    tenantA = await createTestInstitute(db);
    tenantB = await createTestInstitute(db);
    const [branding] = await asAdmin((tx) =>
      tx
        .insert(instituteBranding)
        .values({
          tenantId: tenantA.tenantId,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: instituteBranding.id }),
    );
    assert(branding);
    brandingId = branding.id;
    const [profile] = await asAdmin((tx) =>
      tx
        .insert(userProfiles)
        .values({
          userId: tenantA.userId,
          firstName: { en: 'Sweeper' },
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: userProfiles.id }),
    );
    assert(profile);
    profileId = profile.id;
    reseller = await createTestReseller(db);
    const [staff] = await asAdmin((tx) =>
      tx
        .insert(staffProfiles)
        .values({
          tenantId: tenantA.tenantId,
          userId: tenantA.userId,
          membershipId: tenantA.membershipId,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: staffProfiles.id }),
    );
    assert(staff);
    staffProfileId = staff.id;
  });

  beforeEach(() => {
    createdFileIds = [];
    createdLeaveIds = [];
    createdDocumentIds = [];
    storage = new FlakyStorage();
    repo = new RacingRepository(db, 'workflow:file-sweeper');
    sweeper = new FileSweeper(repo, storage, new Logger('FileSweeperTest'));
  });

  afterEach(async () => {
    if (!db) return;
    await asAdmin(async (tx) => {
      await tx
        .update(instituteBranding)
        .set({ logoFileId: null, faviconFileId: null, coverImageFileId: null })
        .where(eq(instituteBranding.id, brandingId));
      await tx
        .update(userProfiles)
        .set({ profileImageFileId: null })
        .where(eq(userProfiles.id, profileId));
      await tx
        .update(resellers)
        .set({ logoFileId: null })
        .where(eq(resellers.id, reseller.resellerId));
      await tx
        .delete(staffQualifications)
        .where(eq(staffQualifications.staffProfileId, staffProfileId));
      if (createdFileIds.length > 0) {
        await tx.delete(leaveFiles).where(inArray(leaveFiles.fileId, createdFileIds));
      }
      if (createdLeaveIds.length > 0) {
        await tx.delete(leaves).where(inArray(leaves.id, createdLeaveIds));
      }
      if (createdDocumentIds.length > 0) {
        // Its pages go with it (ON DELETE CASCADE).
        await tx.delete(userDocuments).where(inArray(userDocuments.id, createdDocumentIds));
      }
      if (createdFileIds.length > 0) {
        await tx.delete(files).where(inArray(files.id, createdFileIds));
      }
    });
  });

  afterAll(async () => {
    if (!db) return;
    await asAdmin(async (tx) => {
      await tx.delete(instituteBranding).where(eq(instituteBranding.id, brandingId));
      await tx.delete(userProfiles).where(eq(userProfiles.id, profileId));
      // Its qualifications go with it (ON DELETE CASCADE).
      await tx.delete(staffProfiles).where(eq(staffProfiles.id, staffProfileId));
    });
    await cleanupTestInstitute(db, tenantA);
    await cleanupTestInstitute(db, tenantB);
    await cleanupTestReseller(db, reseller);
    await pool.end();
  });

  describe('stale uploads', () => {
    it('should remove an upload left PENDING for over 24 hours with its pending object', async () => {
      const stale = await insertFile(tenantA, { status: 'PENDING', createdAt: hoursAgo(25) });
      await putPending(stale);

      const summary = await sweeper.sweep(NOW);

      expect(await rowOf(stale.id)).toBeUndefined();
      expect(hasPending(stale)).toBe(false);
      expect(summary.pending).toEqual({ removed: 1, failed: 0, skipped: 0 });
    });

    it('should leave a fresh PENDING upload and its object alone', async () => {
      const fresh = await insertFile(tenantA, { status: 'PENDING', createdAt: hoursAgo(23) });
      await putPending(fresh);

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(fresh.id))?.status).toBe('PENDING');
      expect(hasPending(fresh)).toBe(true);
      expect(summary.pending).toEqual(NONE);
    });

    it('should leave no pending object and no image sizes of a stale image upload', async () => {
      const image = await insertFile(tenantA, {
        status: 'PENDING',
        image: true,
        createdAt: hoursAgo(30),
      });
      await putPending(image);
      // Sizes written by a verification that stopped before the row was updated.
      await putStored(image);

      await sweeper.sweep(NOW);

      expect(await rowOf(image.id)).toBeUndefined();
      expect(hasPending(image)).toBe(false);
      expect(storedLeft(image)).toEqual([]);
    });

    it('should record the system user and a new version when it rejects a stale upload', async () => {
      const upload = await insertFile(tenantA, { status: 'PENDING', createdAt: hoursAgo(25) });
      const before = await versionOf(upload.id);

      await expect(repo.rejectPending(upload.id)).resolves.toBe(true);

      expect(await versionOf(upload.id)).toEqual({
        status: 'REJECTED',
        updatedBy: SYSTEM_USER_ID,
        version: before.version + 1,
      });
    });

    it('should refuse to reject an upload that was attached after it was selected', async () => {
      const upload = await insertFile(tenantA, { status: 'PENDING', createdAt: hoursAgo(25) });
      const selected = await repo.findStale('pending', NOW, 100);
      expect(selected.map((file) => file.id)).toContain(upload.id);
      await asAdmin((tx) =>
        tx.update(files).set({ status: 'READY' }).where(eq(files.id, upload.id)),
      );

      await expect(repo.rejectPending(upload.id)).resolves.toBe(false);

      expect((await rowOf(upload.id))?.status).toBe('READY');
    });

    it('should keep the objects of an upload attached while the sweep was running', async () => {
      const upload = await insertFile(tenantA, { status: 'PENDING', createdAt: hoursAgo(25) });
      await putPending(upload);
      repo.onSelect = async (found) => {
        await asAdmin((tx) =>
          tx.update(files).set({ status: 'READY' }).where(eq(files.id, upload.id)),
        );
        return found;
      };

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(upload.id))?.status).toBe('READY');
      expect(hasPending(upload)).toBe(true);
      expect(summary.pending).toEqual({ removed: 0, failed: 0, skipped: 1 });
    });
  });

  describe('refused uploads', () => {
    it('should remove a REJECTED row older than 24 hours and keep a fresh one', async () => {
      const old = await insertFile(tenantA, {
        status: 'REJECTED',
        createdAt: hoursAgo(30),
        updatedAt: hoursAgo(25),
      });
      const fresh = await insertFile(tenantA, {
        status: 'REJECTED',
        createdAt: hoursAgo(30),
        updatedAt: hoursAgo(2),
      });
      await putPending(old);
      await putStored(old);
      await putPending(fresh);

      const summary = await sweeper.sweep(NOW);

      expect(await rowOf(old.id)).toBeUndefined();
      expect(hasPending(old)).toBe(false);
      expect(storedLeft(old)).toEqual([]);
      expect((await rowOf(fresh.id))?.status).toBe('REJECTED');
      expect(hasPending(fresh)).toBe(true);
      expect(summary.rejected).toEqual({ removed: 1, failed: 0, skipped: 0 });
    });
  });

  describe('deleted files', () => {
    it('should keep a deleted file and its objects during the 30-day grace period', async () => {
      const recent = await insertFile(tenantA, {
        status: 'DELETED',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(29),
      });
      await putStored(recent);

      await sweeper.sweep(NOW);

      expect((await rowOf(recent.id))?.status).toBe('DELETED');
      expect(storedLeft(recent)).toEqual(storedKeysOf(recent));
    });

    it('should remove a deleted file past its grace period with its object and every size', async () => {
      const old = await insertFile(tenantA, {
        status: 'DELETED',
        purpose: 'INSTITUTE_LOGO',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      await putStored(old);

      const summary = await sweeper.sweep(NOW);

      expect(await rowOf(old.id)).toBeUndefined();
      expect(storedLeft(old)).toEqual([]);
      expect(summary.deleted).toEqual({ removed: 1, failed: 0, skipped: 0 });
    });

    it('should remove the deleted link row of a leave together with the file', async () => {
      const file = await insertFile(tenantA, {
        status: 'DELETED',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      const linkId = await linkToLeave(tenantA, file.id, true);

      await sweeper.sweep(NOW);

      expect(await leaveLinkExists(linkId)).toBe(false);
      expect(await rowOf(file.id)).toBeUndefined();
    });

    it('should remove the deleted page row of a document together with the file', async () => {
      const file = await insertFile(tenantA, {
        status: 'DELETED',
        purpose: 'USER_DOCUMENT',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      const pageId = await linkToUserDocument(file.id, true);

      const summary = await sweeper.sweep(NOW);

      expect(await documentPageExists(pageId)).toBe(false);
      expect(await rowOf(file.id)).toBeUndefined();
      expect(summary.deleted).toEqual({ removed: 1, failed: 0, skipped: 0 });
    });

    it('should never remove a deleted file that a live document page still points at', async () => {
      const file = await insertFile(tenantA, {
        status: 'DELETED',
        purpose: 'USER_DOCUMENT',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      const pageId = await linkToUserDocument(file.id, false);

      const summary = await sweeper.sweep(NOW);

      expect(await documentPageExists(pageId)).toBe(true);
      expect((await rowOf(file.id))?.status).toBe('DELETED');
      expect(summary.deleted).toEqual(NONE);
    });

    it('should never remove a deleted file that a live leave still points at', async () => {
      const file = await insertFile(tenantA, {
        status: 'DELETED',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      const linkId = await linkToLeave(tenantA, file.id, false);
      await putStored(file);

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(file.id))?.status).toBe('DELETED');
      expect(await leaveLinkExists(linkId)).toBe(true);
      expect(storedLeft(file)).toEqual(storedKeysOf(file));
      expect(summary.deleted).toEqual(NONE);
    });

    it('should skip, not throw, when a live leave link appears after selection', async () => {
      const file = await insertFile(tenantA, {
        status: 'DELETED',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      await putStored(file);
      repo.onSelect = async (found) => {
        await linkToLeave(tenantA, file.id, false);
        return found;
      };

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(file.id))?.status).toBe('DELETED');
      expect(storedLeft(file)).toEqual(storedKeysOf(file));
      expect(summary.deleted).toEqual({ removed: 0, failed: 0, skipped: 1 });
    });

    it('should never remove a deleted file that institute branding still points at', async () => {
      const file = await insertFile(tenantA, {
        status: 'DELETED',
        purpose: 'INSTITUTE_COVER',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      await pointBranding('coverImageFileId', file.id);
      await putStored(file);

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(file.id))?.status).toBe('DELETED');
      expect(storedLeft(file)).toEqual(storedKeysOf(file));
      expect(summary.deleted).toEqual(NONE);
      await expect(sweeper.purge([file.id])).resolves.toEqual({
        removed: [],
        inUse: [file.id],
        missing: [],
      });
    });

    it('should never remove a deleted profile photo that a user profile still points at', async () => {
      const photo = await insertFile(tenantA, {
        status: 'DELETED',
        purpose: 'PROFILE_PHOTO',
        image: true,
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      await pointProfileAt(photo.id);
      await putStored(photo);

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(photo.id))?.status).toBe('DELETED');
      expect(storedLeft(photo)).toEqual(storedKeysOf(photo));
      expect(await profilePhotoOf()).toBe(photo.id);
      expect(summary.deleted).toEqual(NONE);
    });

    it('should never remove a deleted reseller logo that its reseller still points at', async () => {
      const logo = await insertFile(tenantA, {
        status: 'DELETED',
        purpose: 'RESELLER_LOGO',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      await pointResellerLogoAt(logo.id);
      await putStored(logo);

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(logo.id))?.status).toBe('DELETED');
      expect(storedLeft(logo)).toEqual(storedKeysOf(logo));
      expect(await resellerLogoOf()).toBe(logo.id);
      expect(summary.deleted).toEqual(NONE);
    });

    it('should never remove a deleted certificate that a live qualification still points at', async () => {
      const certificate = await insertFile(tenantA, {
        status: 'DELETED',
        purpose: 'STAFF_CERTIFICATE',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      const qualificationId = await insertQualification(certificate.id, false);
      await putStored(certificate);

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(certificate.id))?.status).toBe('DELETED');
      expect(storedLeft(certificate)).toEqual(storedKeysOf(certificate));
      expect(await certificateOf(qualificationId)).toBe(certificate.id);
      expect(summary.deleted).toEqual(NONE);
    });

    it('should remove a deleted certificate whose qualification was deleted, clearing its pointer', async () => {
      const certificate = await insertFile(tenantA, {
        status: 'DELETED',
        purpose: 'STAFF_CERTIFICATE',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      const qualificationId = await insertQualification(certificate.id, true);
      await putStored(certificate);

      const summary = await sweeper.sweep(NOW);

      expect(await rowOf(certificate.id)).toBeUndefined();
      expect(storedLeft(certificate)).toEqual([]);
      expect(await certificateOf(qualificationId)).toBeNull();
      expect(summary.deleted).toEqual({ removed: 1, failed: 0, skipped: 0 });
    });

    it('should skip, not throw, when a user profile starts pointing at the file after selection', async () => {
      const photo = await insertFile(tenantA, {
        status: 'DELETED',
        purpose: 'PROFILE_PHOTO',
        image: true,
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      await putStored(photo);
      repo.onSelect = async (found) => {
        await pointProfileAt(photo.id);
        return found;
      };

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(photo.id))?.status).toBe('DELETED');
      expect(storedLeft(photo)).toEqual(storedKeysOf(photo));
      expect(summary.deleted).toEqual({ removed: 0, failed: 0, skipped: 1 });
    });

    it('should still remove the row when its object is already gone', async () => {
      const file = await insertFile(tenantA, {
        status: 'DELETED',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });

      const summary = await sweeper.sweep(NOW);

      expect(await rowOf(file.id)).toBeUndefined();
      expect(summary.deleted).toEqual({ removed: 1, failed: 0, skipped: 0 });
    });

    it('should keep the row when storage fails, and go on with the other files', async () => {
      const broken = await insertFile(tenantA, {
        status: 'DELETED',
        createdAt: daysAgo(62),
        deletedAt: daysAgo(31),
      });
      const healthy = await insertFile(tenantA, {
        status: 'DELETED',
        createdAt: daysAgo(61),
        deletedAt: daysAgo(31),
      });
      await putStored(broken);
      await putStored(healthy);
      storage.failFor.add(broken.objectKey);

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(broken.id))?.status).toBe('DELETED');
      expect(storedLeft(broken)).toEqual(storedKeysOf(broken));
      expect(await rowOf(healthy.id)).toBeUndefined();
      expect(storedLeft(healthy)).toEqual([]);
      expect(summary.deleted).toEqual({ removed: 1, failed: 1, skipped: 0 });
    });
  });

  describe('runs', () => {
    it('should change nothing and report nothing when run twice in a row', async () => {
      await insertFile(tenantA, { status: 'PENDING', createdAt: hoursAgo(25) });
      await insertFile(tenantA, { status: 'REJECTED', createdAt: hoursAgo(26) });
      await insertFile(tenantA, {
        status: 'DELETED',
        createdAt: daysAgo(60),
        deletedAt: daysAgo(31),
      });
      const kept = await insertFile(tenantA, { status: 'PENDING', createdAt: hoursAgo(1) });
      await sweeper.sweep(NOW);

      const second = await sweeper.sweep(NOW);

      expect(second).toEqual({
        retired: { timed: 0, unused: 0 },
        pending: NONE,
        rejected: NONE,
        deleted: NONE,
      });
      expect((await rowOf(kept.id))?.status).toBe('PENDING');
    });

    it('should sweep the files of every institute in one run', async () => {
      const ofA = await insertFile(tenantA, { status: 'PENDING', createdAt: hoursAgo(25) });
      const ofB = await insertFile(tenantB, { status: 'PENDING', createdAt: hoursAgo(25) });
      await putPending(ofA);
      await putPending(ofB);

      const summary = await sweeper.sweep(NOW);

      expect(await rowOf(ofA.id)).toBeUndefined();
      expect(await rowOf(ofB.id)).toBeUndefined();
      expect(hasPending(ofA)).toBe(false);
      expect(hasPending(ofB)).toBe(false);
      expect(summary.pending).toEqual({ removed: 2, failed: 0, skipped: 0 });
    });
  });

  describe('retireUnneeded', () => {
    it('should retire an import sheet after 30 days and keep a newer one', async () => {
      const old = await insertFile(tenantA, {
        status: 'READY',
        purpose: 'BULK_IMPORT_CSV',
        createdAt: daysAgo(31),
      });
      const recent = await insertFile(tenantA, {
        status: 'READY',
        purpose: 'BULK_IMPORT_CSV',
        createdAt: daysAgo(29),
      });

      const summary = await sweeper.sweep(NOW);

      expect(await rowOf(old.id)).toEqual({
        status: 'DELETED',
        deletedAt: NOW,
        deletedBy: SYSTEM_USER_ID,
      });
      expect((await rowOf(recent.id))?.status).toBe('READY');
      expect(summary.retired).toEqual({ timed: 1, unused: 0 });
    });

    it('should retire an institute logo that nothing points at after 24 hours', async () => {
      const logo = await insertFile(tenantA, {
        status: 'READY',
        purpose: 'INSTITUTE_LOGO',
        createdAt: hoursAgo(25),
      });
      await putStored(logo);

      const summary = await sweeper.sweep(NOW);

      expect(await rowOf(logo.id)).toEqual({
        status: 'DELETED',
        deletedAt: NOW,
        deletedBy: SYSTEM_USER_ID,
      });
      // Retired only: the objects stay for the grace period.
      expect(storedLeft(logo)).toEqual(storedKeysOf(logo));
      expect(summary.retired).toEqual({ timed: 0, unused: 1 });
    });

    it('should keep a profile photo that a user profile points at', async () => {
      const photo = await insertFile(tenantA, {
        status: 'READY',
        purpose: 'PROFILE_PHOTO',
        image: true,
        createdAt: hoursAgo(25),
      });
      await pointProfileAt(photo.id);

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(photo.id))?.status).toBe('READY');
      expect(summary.retired).toEqual({ timed: 0, unused: 0 });
    });

    it('should keep an institute logo that the branding points at', async () => {
      const logo = await insertFile(tenantA, {
        status: 'READY',
        purpose: 'INSTITUTE_LOGO',
        createdAt: hoursAgo(25),
      });
      await pointBranding('logoFileId', logo.id);

      await sweeper.sweep(NOW);

      expect((await rowOf(logo.id))?.status).toBe('READY');
    });

    it('should keep a leave attachment with a live link and retire one whose link was deleted', async () => {
      const linked = await insertFile(tenantA, { status: 'READY', createdAt: hoursAgo(48) });
      const unlinked = await insertFile(tenantA, { status: 'READY', createdAt: hoursAgo(48) });
      await linkToLeave(tenantA, linked.id, false);
      await linkToLeave(tenantA, unlinked.id, true);

      const summary = await sweeper.sweep(NOW);

      expect((await rowOf(linked.id))?.status).toBe('READY');
      expect((await rowOf(unlinked.id))?.status).toBe('DELETED');
      expect(summary.retired).toEqual({ timed: 0, unused: 1 });
    });
  });

  describe('purge', () => {
    it('should remove a file and its objects at once, whatever its age', async () => {
      const file = await insertFile(tenantA, {
        status: 'READY',
        createdAt: new Date(),
      });
      await putPending(file);
      await putStored(file);

      const result = await sweeper.purge([file.id]);

      expect(result).toEqual({ removed: [file.id], inUse: [], missing: [] });
      expect(await rowOf(file.id)).toBeUndefined();
      expect(hasPending(file)).toBe(false);
      expect(storedLeft(file)).toEqual([]);
    });

    it('should reject and remove a pending upload', async () => {
      const upload = await insertFile(tenantA, { status: 'PENDING', createdAt: new Date() });
      await putPending(upload);

      await expect(sweeper.purge([upload.id])).resolves.toEqual({
        removed: [upload.id],
        inUse: [],
        missing: [],
      });
      expect(await rowOf(upload.id)).toBeUndefined();
      expect(hasPending(upload)).toBe(false);
    });

    it('should refuse a file in use and report unknown ids', async () => {
      const used = await insertFile(tenantA, { status: 'READY', createdAt: new Date() });
      await linkToLeave(tenantA, used.id, false);
      await putStored(used);
      const unknown = randomUUID();

      const result = await sweeper.purge([used.id, unknown]);

      expect(result).toEqual({ removed: [], inUse: [used.id], missing: [unknown] });
      expect((await rowOf(used.id))?.status).toBe('READY');
      expect(storedLeft(used)).toEqual(storedKeysOf(used));
    });
  });
});
