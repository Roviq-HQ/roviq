/**
 * ROV-300 — `deleteStudentDocument` through GraphQL and PostgreSQL: the document, its pages and
 * their files are soft-deleted together, and every caller who cannot reach the document changes
 * nothing.
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
  userDocumentFiles,
  userDocuments,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:student-document-removal';

const DELETE = /* GraphQL */ `
  mutation DeleteStudentDocument($id: ID!) {
    deleteStudentDocument(id: $id)
  }
`;
const LIST = /* GraphQL */ `
  query ListStudentDocuments($studentProfileId: ID!) {
    listStudentDocuments(studentProfileId: $studentProfileId) {
      id
    }
  }
`;
const DOWNLOAD = /* GraphQL */ `
  mutation FileDownloadUrl($fileId: ID!) {
    fileDownloadUrl(fileId: $fileId)
  }
`;

interface StoredDocument {
  id: string;
  fileIds: string[];
}

describe('deleteStudentDocument (integration)', () => {
  let app: IntegrationAppResult;
  let tenant: TestInstitute;
  let foreignTenant: TestInstitute;
  let teacher: TestTeacher;
  let vicePrincipal: TestTeacher;
  let adminToken: string;
  let foreignAdminToken: string;
  let teacherToken: string;
  let vicePrincipalToken: string;
  let studentUserId: string;
  let studentProfileId: string;
  const documentIds: string[] = [];
  const fileIds: string[] = [];

  const tokenFor = (person: TestTeacher | TestInstitute, tenantId: string) =>
    createInstituteToken({
      sub: person.userId,
      tenantId,
      membershipId: person.membershipId,
      roleId: person.roleId,
    });

  async function createStudent(): Promise<void> {
    const suffix = randomUUID().slice(0, 8);
    await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: `doc_student_${suffix}@test.local`,
          username: `doc_stu_${suffix}`,
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

  async function createDocument(type: UserDocumentType, pages: number): Promise<StoredDocument> {
    return withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [document] = await tx
        .insert(userDocuments)
        .values({
          userId: studentUserId,
          type,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: userDocuments.id });
      documentIds.push(document.id);
      const pageFileIds: string[] = [];
      for (let position = 0; position < pages; position++) {
        const [file] = await tx
          .insert(files)
          .values({
            subjectUserId: studentUserId,
            visibility: 'PRIVATE',
            purpose: 'USER_DOCUMENT',
            objectKey: `users/${studentUserId}/user-document/${randomUUID()}.pdf`,
            originalName: `page-${position}.pdf`,
            contentType: 'application/pdf',
            sizeBytes: 2048,
            status: 'READY',
            uploadedBy: tenant.userId,
            createdBy: tenant.userId,
            updatedBy: tenant.userId,
          })
          .returning({ id: files.id });
        fileIds.push(file.id);
        pageFileIds.push(file.id);
        await tx.insert(userDocumentFiles).values({
          documentId: document.id,
          userId: studentUserId,
          fileId: file.id,
          position,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        });
      }
      return { id: document.id, fileIds: pageFileIds };
    });
  }

  /** Base-table state, read as admin so soft-deleted rows are visible. */
  async function stored(document: StoredDocument) {
    return withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .select({
          deletedAt: userDocuments.deletedAt,
          deletedBy: userDocuments.deletedBy,
          updatedBy: userDocuments.updatedBy,
        })
        .from(userDocuments)
        .where(eq(userDocuments.id, document.id));
      const pages = await tx
        .select({ deletedAt: userDocumentFiles.deletedAt, deletedBy: userDocumentFiles.deletedBy })
        .from(userDocumentFiles)
        .where(eq(userDocumentFiles.documentId, document.id));
      const fileRows = await tx
        .select({ status: files.status, deletedAt: files.deletedAt, deletedBy: files.deletedBy })
        .from(files)
        .where(inArray(files.id, document.fileIds));
      return { row, pages, files: fileRows };
    });
  }

  async function expectUntouched(document: StoredDocument) {
    const state = await stored(document);
    expect(state.row).toEqual({ deletedAt: null, deletedBy: null, updatedBy: SYSTEM_USER_ID });
    expect(state.pages).toEqual(document.fileIds.map(() => ({ deletedAt: null, deletedBy: null })));
    expect(state.files).toEqual(
      document.fileIds.map(() => ({ status: 'READY', deletedAt: null, deletedBy: null })),
    );
  }

  const remove = (id: string, token: string) =>
    gqlRequest<{ deleteStudentDocument: boolean }>(app.httpServer, {
      query: DELETE,
      variables: { id },
      token,
    });

  async function listedIds(token: string): Promise<string[]> {
    const response = await gqlRequest<{ listStudentDocuments: { id: string }[] }>(app.httpServer, {
      query: LIST,
      variables: { studentProfileId },
      token,
    });
    expect(response.errors).toBeUndefined();
    return (response.data?.listStudentDocuments ?? []).map((document) => document.id);
  }

  beforeAll(async () => {
    assert.equal(new URL(process.env.DATABASE_URL_TEST ?? '').pathname, '/roviq_test');
    app = await createIntegrationApp({ modules: [AppModule] });
    tenant = await createTestInstitute(app.db);
    foreignTenant = await createTestInstitute(app.db);
    teacher = await createTestTeacher(app.db, tenant.tenantId);
    vicePrincipal = await createTestTeacher(app.db, tenant.tenantId);
    await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      await tx
        .update(roles)
        .set({ abilities: DEFAULT_ROLE_ABILITIES.vice_principal })
        .where(eq(roles.id, vicePrincipal.roleId));
      await tx
        .update(memberships)
        .set({ abilities: [] })
        .where(eq(memberships.id, vicePrincipal.membershipId));
    });
    adminToken = tokenFor(tenant, tenant.tenantId);
    foreignAdminToken = tokenFor(foreignTenant, foreignTenant.tenantId);
    teacherToken = tokenFor(teacher, tenant.tenantId);
    vicePrincipalToken = tokenFor(vicePrincipal, tenant.tenantId);
    await createStudent();
  });

  afterAll(async () => {
    if (!app) return;
    await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      // Pages go with their document (ON DELETE CASCADE).
      if (documentIds.length > 0) {
        await tx.delete(userDocuments).where(inArray(userDocuments.id, documentIds));
      }
      if (fileIds.length > 0) await tx.delete(files).where(inArray(files.id, fileIds));
      if (studentProfileId) {
        await tx.delete(studentProfiles).where(eq(studentProfiles.id, studentProfileId));
      }
      if (studentUserId) {
        await tx.delete(userProfiles).where(eq(userProfiles.userId, studentUserId));
        await tx.delete(memberships).where(eq(memberships.userId, studentUserId));
        await tx.delete(users).where(eq(users.id, studentUserId));
      }
    });
    await cleanupTestTeacher(app.db, teacher);
    await cleanupTestTeacher(app.db, vicePrincipal);
    await cleanupTestInstitute(app.db, tenant);
    await cleanupTestInstitute(app.db, foreignTenant);
    await app.close();
  });

  it('removes the document, its pages and files, and leaves the other document alone', async () => {
    const target = await createDocument('BIRTH_CERTIFICATE', 2);
    const other = await createDocument('REPORT_CARD', 1);

    const response = await remove(target.id, adminToken);

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteStudentDocument).toBe(true);
    const listed = await listedIds(adminToken);
    expect(listed).not.toContain(target.id);
    expect(listed).toContain(other.id);

    const state = await stored(target);
    expect(state.row.deletedAt).toBeInstanceOf(Date);
    expect(state.row.deletedBy).toBe(tenant.userId);
    expect(state.row.updatedBy).toBe(tenant.userId);
    expect(state.pages).toHaveLength(2);
    for (const page of state.pages) {
      expect(page.deletedAt).toBeInstanceOf(Date);
      expect(page.deletedBy).toBe(tenant.userId);
    }
    expect(state.files).toHaveLength(2);
    for (const file of state.files) {
      expect(file.status).toBe('DELETED');
      expect(file.deletedAt).toBeInstanceOf(Date);
      expect(file.deletedBy).toBe(tenant.userId);
    }
    await expectUntouched(other);

    const download = await gqlRequest(app.httpServer, {
      query: DOWNLOAD,
      variables: { fileId: target.fileIds[0] },
      token: adminToken,
    });
    expect(download.errors?.[0]?.extensions?.code).toBe(ErrorCode.FILE_NOT_FOUND);

    const again = await remove(target.id, adminToken);
    expect(again.errors?.[0]?.extensions?.code).toBe(ErrorCode.STUDENT_NOT_FOUND);
  });

  it("answers STUDENT_NOT_FOUND to another institute's admin and changes nothing", async () => {
    const document = await createDocument('BIRTH_CERTIFICATE', 1);

    const response = await remove(document.id, foreignAdminToken);

    expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.STUDENT_NOT_FOUND);
    await expectUntouched(document);
  });

  it('answers FORBIDDEN to a role with read-only student rights and changes nothing', async () => {
    const document = await createDocument('BIRTH_CERTIFICATE', 1);

    const response = await remove(document.id, teacherToken);

    expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
    await expectUntouched(document);
  });

  it('hides an Aadhaar document from a caller without the aadhaar field', async () => {
    const aadhaar = await createDocument('AADHAAR_CARD', 1);

    const response = await remove(aadhaar.id, vicePrincipalToken);

    expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.STUDENT_NOT_FOUND);
    await expectUntouched(aadhaar);
  });

  it('lets a caller without the aadhaar field remove another document type', async () => {
    const document = await createDocument('REPORT_CARD', 1);

    const response = await remove(document.id, vicePrincipalToken);

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteStudentDocument).toBe(true);
    expect((await stored(document)).row.deletedBy).toBe(vicePrincipal.userId);
  });

  it('answers STUDENT_NOT_FOUND for an unknown id', async () => {
    const response = await remove(randomUUID(), adminToken);

    expect(response.errors?.[0]?.extensions?.code).toBe(ErrorCode.STUDENT_NOT_FOUND);
  });

  it('rejects an id that is not a UUID', async () => {
    const response = await remove('not-a-uuid', adminToken);

    expect(response.errors?.[0]?.extensions?.code).toBe('BAD_REQUEST');
  });
});
