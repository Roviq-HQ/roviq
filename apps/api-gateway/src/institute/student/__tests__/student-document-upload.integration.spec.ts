/**
 * ROV-300 — `uploadStudentDocument` follows the removal rules: a student outside the caller's
 * read scope answers STUDENT_NOT_FOUND, an Aadhaar card needs the `aadhaar` field, and a refused
 * upload writes no document and leaves its files PENDING.
 *
 * ROV-303 — a page is scanned for malware before it is attached: an infected one is
 * QUARANTINED and its bytes removed, and without a verdict nothing is attached.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  DEFAULT_ROLE_ABILITIES,
  ErrorCode,
  SocialCategory,
  type UserDocumentType,
} from '@roviq/common-types';
import {
  files,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  studentProfiles,
  tenantUserProfiles,
  userDocuments,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import type { JetStreamClient } from '@roviq/nats-jetstream';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { EICAR_TEST_STRING, EicarFileScanner } from '../../../files/scan/eicar-file-scanner';
import {
  FileScanner,
  ScannerUnavailableError,
  type ScanResult,
} from '../../../files/scan/file-scanner';

const ORIGIN = 'test:student-document-upload';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const INFECTED_PDF = Buffer.from(`%PDF-1.7\n${EICAR_TEST_STRING}\n`);

/** The EICAR stand-in, which can be stopped to play a scanner outage. */
class StoppableScanner extends FileScanner {
  stopped = false;
  private readonly eicar = new EicarFileScanner();

  async scan(bytes: Buffer): Promise<ScanResult> {
    if (this.stopped) throw new ScannerUnavailableError('connect ECONNREFUSED');
    return this.eicar.scan(bytes);
  }
}

interface Published {
  pattern: string;
  payload: Record<string, unknown>;
}

const UPLOAD = /* GraphQL */ `
  mutation UploadStudentDocument($input: UploadStudentDocumentInput!) {
    uploadStudentDocument(input: $input) {
      id
      userId
      type
      files {
        id
      }
    }
  }
`;

describe('uploadStudentDocument (integration)', () => {
  let app: IntegrationAppResult;
  let storage: FakeStorageClient;
  const scanner = new StoppableScanner();
  const published: Published[] = [];
  let tenant: TestInstitute;
  let sectionTeacher: TestTeacher;
  let vicePrincipal: TestTeacher;
  let adminToken: string;
  let sectionTeacherToken: string;
  let vicePrincipalToken: string;
  let studentUserId: string;
  let studentProfileId: string;
  const fileIds: string[] = [];

  const tokenFor = (person: TestTeacher | TestInstitute) =>
    createInstituteToken({
      sub: person.userId,
      tenantId: tenant.tenantId,
      membershipId: person.membershipId,
      roleId: person.roleId,
    });

  async function createStudent(): Promise<void> {
    const suffix = randomUUID().slice(0, 8);
    await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: `upload_student_${suffix}@test.local`,
          username: `upload_stu_${suffix}`,
          passwordHash: 'not-a-real-hash',
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: users.id });
      await tx.insert(userProfiles).values({
        userId: user.id,
        firstName: { en: `Student ${suffix}` },
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      });
      await tx.insert(tenantUserProfiles).values({
        tenantId: tenant.tenantId,
        userId: user.id,
        firstName: { en: `Student ${suffix}` },
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      });
      const [membership] = await tx
        .insert(memberships)
        .values({
          userId: user.id,
          roleId: tenant.roleId,
          tenantId: tenant.tenantId,
          abilities: [],
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: memberships.id });
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId: tenant.tenantId,
          userId: user.id,
          membershipId: membership.id,
          admissionNumber: `ADM-${suffix}`,
          admissionDate: '2025-04-01',
          admissionType: AdmissionType.NEW,
          academicStatus: AcademicStatus.ENROLLED,
          socialCategory: SocialCategory.GENERAL,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: studentProfiles.id });
      studentUserId = user.id;
      studentProfileId = profile.id;
    });
  }

  /** A page the uploader has put in storage but not attached yet, as `requestFileUpload` leaves it. */
  async function createPendingFile(uploaderId: string, bytes = PDF): Promise<string> {
    const objectKey = `users/${studentUserId}/user-document/${randomUUID()}.pdf`;
    await storage.put('private', `pending/${objectKey}`, bytes, { contentType: 'application/pdf' });
    const id = await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [file] = await tx
        .insert(files)
        .values({
          subjectUserId: studentUserId,
          visibility: 'PRIVATE',
          purpose: 'USER_DOCUMENT',
          objectKey,
          originalName: 'page.pdf',
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
          status: 'PENDING',
          uploadedBy: uploaderId,
          createdBy: uploaderId,
          updatedBy: uploaderId,
        })
        .returning({ id: files.id });
      return file.id;
    });
    fileIds.push(id);
    return id;
  }

  async function fileStatuses(ids: string[]): Promise<string[]> {
    return withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const rows = await tx
        .select({ id: files.id, status: files.status })
        .from(files)
        .where(inArray(files.id, ids));
      return ids.map((id) => rows.find((row) => row.id === id)?.status ?? 'MISSING');
    });
  }

  async function objectKeyOf(id: string): Promise<string> {
    return withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .select({ objectKey: files.objectKey })
        .from(files)
        .where(eq(files.id, id));
      assert(row);
      return row.objectKey;
    });
  }

  async function documentTypes(): Promise<string[]> {
    return withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const rows = await tx
        .select({ type: userDocuments.type })
        .from(userDocuments)
        .where(eq(userDocuments.userId, studentUserId));
      return rows.map((row) => row.type).sort();
    });
  }

  const upload = (type: UserDocumentType, pageIds: string[], token: string) =>
    gqlRequest<{
      uploadStudentDocument: { id: string; userId: string; type: string; files: { id: string }[] };
    }>(app.httpServer, {
      query: UPLOAD,
      variables: { input: { studentProfileId, type, fileIds: pageIds } },
      token,
    });

  beforeAll(async () => {
    assert.equal(new URL(process.env.DATABASE_URL_TEST ?? '').pathname, '/roviq_test');
    storage = new FakeStorageClient();
    // What the gateway publishes is read from the NATS client it publishes through.
    const nats = createMock<JetStreamClient>({
      emit: vi.fn((pattern: string, payload: Record<string, unknown>) => {
        published.push({ pattern, payload });
        return of(undefined);
      }),
    });
    app = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: storage },
        { provide: FileScanner, useValue: scanner },
        { provide: 'JETSTREAM_CLIENT', useValue: nats },
      ],
    });
    tenant = await createTestInstitute(app.db);
    sectionTeacher = await createTestTeacher(app.db, tenant.tenantId);
    vicePrincipal = await createTestTeacher(app.db, tenant.tenantId);
    await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      // May edit students but reads only its own sections, and it has none.
      await tx
        .update(roles)
        .set({
          abilities: [
            ...DEFAULT_ROLE_ABILITIES.class_teacher,
            { action: 'update', subject: 'Student' },
          ],
        })
        .where(eq(roles.id, sectionTeacher.roleId));
      await tx
        .update(roles)
        .set({ abilities: DEFAULT_ROLE_ABILITIES.vice_principal })
        .where(eq(roles.id, vicePrincipal.roleId));
      await tx
        .update(memberships)
        .set({ abilities: [] })
        .where(inArray(memberships.id, [sectionTeacher.membershipId, vicePrincipal.membershipId]));
    });
    adminToken = tokenFor(tenant);
    sectionTeacherToken = tokenFor(sectionTeacher);
    vicePrincipalToken = tokenFor(vicePrincipal);
    await createStudent();
  });

  afterAll(async () => {
    if (!app) return;
    await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      // Pages go with their document (ON DELETE CASCADE).
      if (studentUserId) {
        await tx.delete(userDocuments).where(eq(userDocuments.userId, studentUserId));
      }
      if (fileIds.length > 0) await tx.delete(files).where(inArray(files.id, fileIds));
      if (studentProfileId) {
        await tx.delete(studentProfiles).where(eq(studentProfiles.id, studentProfileId));
      }
      if (studentUserId) {
        await tx.delete(tenantUserProfiles).where(eq(tenantUserProfiles.userId, studentUserId));
        await tx.delete(userProfiles).where(eq(userProfiles.userId, studentUserId));
        await tx.delete(memberships).where(eq(memberships.userId, studentUserId));
        await tx.delete(users).where(eq(users.id, studentUserId));
      }
    });
    await cleanupTestTeacher(app.db, sectionTeacher);
    await cleanupTestTeacher(app.db, vicePrincipal);
    await cleanupTestInstitute(app.db, tenant);
    await app.close();
  });

  it('answers STUDENT_NOT_FOUND to a caller whose read rules miss the student, writing nothing', async () => {
    const page = await createPendingFile(sectionTeacher.userId);

    const response = await upload('BIRTH_CERTIFICATE', [page], sectionTeacherToken);

    expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.STUDENT_NOT_FOUND);
    expect(await documentTypes()).toEqual([]);
    expect(await fileStatuses([page])).toEqual(['PENDING']);
  });

  it('answers FORBIDDEN for an Aadhaar card to a caller without the aadhaar field, writing nothing', async () => {
    const page = await createPendingFile(vicePrincipal.userId);

    const response = await upload('AADHAAR_CARD', [page], vicePrincipalToken);

    expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
    expect(await documentTypes()).toEqual([]);
    expect(await fileStatuses([page])).toEqual(['PENDING']);
  });

  it('lets a caller without the aadhaar field upload another document type', async () => {
    const page = await createPendingFile(vicePrincipal.userId);

    const response = await upload('REPORT_CARD', [page], vicePrincipalToken);

    expect(response.errors).toBeUndefined();
    expect(response.data?.uploadStudentDocument.type).toBe('REPORT_CARD');
    expect(await fileStatuses([page])).toEqual(['READY']);
  });

  it('saves an Aadhaar card for a caller with full rights and makes its pages READY', async () => {
    const pages = [await createPendingFile(tenant.userId), await createPendingFile(tenant.userId)];

    const response = await upload('AADHAAR_CARD', pages, adminToken);

    expect(response.errors).toBeUndefined();
    const document = response.data?.uploadStudentDocument;
    expect(document?.userId).toBe(studentUserId);
    expect(document?.type).toBe('AADHAAR_CARD');
    expect(document?.files.map((file) => file.id)).toEqual(pages);
    expect(await fileStatuses(pages)).toEqual(['READY', 'READY']);
    expect(await documentTypes()).toEqual(['AADHAAR_CARD', 'REPORT_CARD']);
  });

  it('quarantines an infected page, removes its bytes and records it; nothing is attached', async () => {
    const page = await createPendingFile(tenant.userId, INFECTED_PDF);
    const objectKey = await objectKeyOf(page);
    const before = await documentTypes();
    published.length = 0;

    const response = await upload('MEDICAL_CERTIFICATE', [page], adminToken);

    expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.FILE_INFECTED);
    expect(await fileStatuses([page])).toEqual(['QUARANTINED']);
    expect(storage.has('private', `pending/${objectKey}`)).toBe(false);
    expect(storage.has('private', objectKey)).toBe(false);
    expect(await documentTypes()).toEqual(before);

    const event = published.find((entry) => entry.pattern === 'FILE.quarantined');
    expect(event?.payload).toEqual({
      tenantId: tenant.tenantId,
      resellerId: null,
      fileId: page,
      purpose: 'USER_DOCUMENT',
      uploadedBy: tenant.userId,
      signature: 'Eicar-Test-Signature',
    });
    const audit = published.find(
      (entry) => entry.pattern === 'AUDIT.log' && entry.payload.action === 'quarantineFile',
    );
    expect(audit?.payload).toMatchObject({
      scope: 'institute',
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      actorId: tenant.userId,
      entityType: 'File',
      entityId: page,
      changes: { status: { old: 'PENDING', new: 'QUARANTINED' } },
    });
  });

  it('cannot attach or download a quarantined file afterwards', async () => {
    const page = await createPendingFile(tenant.userId, INFECTED_PDF);
    await upload('MEDICAL_CERTIFICATE', [page], adminToken);

    const again = await upload('MEDICAL_CERTIFICATE', [page], adminToken);
    expect(again.errors?.[0]?.extensions?.code).toBe(ErrorCode.FILE_NOT_FOUND);

    const download = await gqlRequest<{ fileDownloadUrl: string }>(app.httpServer, {
      query: /* GraphQL */ `
        mutation Download($fileId: ID!) {
          fileDownloadUrl(fileId: $fileId)
        }
      `,
      variables: { fileId: page },
      token: adminToken,
    });
    expect(download.errors?.[0]?.extensions?.code).toBe(ErrorCode.FILE_NOT_FOUND);
    expect(await fileStatuses([page])).toEqual(['QUARANTINED']);
  });

  it('fails with a retryable error and keeps the page PENDING while the scanner is stopped', async () => {
    const page = await createPendingFile(tenant.userId);
    const before = await documentTypes();
    scanner.stopped = true;
    try {
      const response = await upload('MEDICAL_CERTIFICATE', [page], adminToken);

      expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.FILE_SCAN_UNAVAILABLE);
      expect(await fileStatuses([page])).toEqual(['PENDING']);
      expect(await documentTypes()).toEqual(before);
    } finally {
      scanner.stopped = false;
    }

    const retried = await upload('MEDICAL_CERTIFICATE', [page], adminToken);
    expect(retried.errors).toBeUndefined();
    expect(await fileStatuses([page])).toEqual(['READY']);
  });
});
