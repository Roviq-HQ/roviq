/**
 * ROV-84 — Deleted list + restore for students, staff and guardians, through
 * the real resolver → CASL → RLS pipeline.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { AcademicStatus, AdmissionType, DefaultRoles, SocialCategory } from '@roviq/common-types';
import {
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  staffProfiles,
  studentProfiles,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app/app.module';

const AUDIT = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const FAKE = {
  USER: '00000000-0000-7000-a000-000000000e84',
  MEMBERSHIP: '00000000-0000-7000-a000-000000000e85',
  ROLE: '00000000-0000-7000-a000-000000000e86',
} as const;

interface Person {
  userId: string;
  membershipId: string;
}

async function createPerson(db: DrizzleDB, tenantId: string, label: string): Promise<Person> {
  const suffix = randomUUID().slice(0, 8);
  return withAdmin(db, mkAdminCtx('test:people-restore'), async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: `rov84_${suffix}@test.local`,
        username: `rov84_${suffix}`,
        passwordHash: 'not-a-real-hash',
        ...AUDIT,
      })
      .returning({ id: users.id });
    await tx.insert(userProfiles).values({ userId: user.id, firstName: { en: label }, ...AUDIT });
    await tx
      .insert(tenantUserProfiles)
      .values({ tenantId: tenantId, userId: user.id, firstName: { en: label }, ...AUDIT });
    const [role] = await tx
      .insert(roles)
      .values({
        name: { en: `Role ${suffix}` },
        scope: 'institute',
        tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        ...AUDIT,
      })
      .returning({ id: roles.id });
    const [membership] = await tx
      .insert(memberships)
      .values({ userId: user.id, roleId: role.id, tenantId, abilities: [], ...AUDIT })
      .returning({ id: memberships.id });
    return { userId: user.id, membershipId: membership.id };
  });
}

async function createStudent(
  db: DrizzleDB,
  tenantId: string,
  admissionNumber: string,
): Promise<string> {
  const person = await createPerson(db, tenantId, `Student ${admissionNumber}`);
  return withAdmin(db, mkAdminCtx('test:people-restore'), async (tx) => {
    const [profile] = await tx
      .insert(studentProfiles)
      .values({
        tenantId,
        ...person,
        admissionNumber,
        admissionDate: '2025-04-01',
        admissionType: AdmissionType.NEW,
        academicStatus: AcademicStatus.ENROLLED,
        socialCategory: SocialCategory.GENERAL,
        ...AUDIT,
      })
      .returning({ id: studentProfiles.id });
    return profile.id;
  });
}

interface DeletedPerson {
  id: string;
  firstName: Record<string, string>;
  identifier: string | null;
  deletedAt: string;
}

describe('People restore (integration)', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;
  let token: string;

  const tokenFor = (i: TestInstitute) =>
    createInstituteToken({
      sub: i.userId,
      tenantId: i.tenantId,
      membershipId: i.membershipId,
      roleId: i.roleId,
    });

  const gql = <T>(query: string, variables: Record<string, unknown> = {}, as = token) =>
    gqlRequest<T>(result.httpServer, { query, variables, token: as });

  async function deletedIds(field: string, as = token): Promise<string[]> {
    const response = await gql<Record<string, DeletedPerson[]>>(
      `query { ${field} { id firstName identifier deletedAt } }`,
      {},
      as,
    );
    expect(response.errors).toBeUndefined();
    assert(response.data);
    return response.data[field].map((row) => row.id);
  }

  async function mutate(field: string, id: string, as = token) {
    return gql<Record<string, boolean>>(`mutation($id: ID!) { ${field}(id: $id) }`, { id }, as);
  }

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    institute = await createTestInstitute(result.db);
    token = tokenFor(institute);
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('students', () => {
    it('a deleted student appears in the Deleted list and returns on restore', async () => {
      const id = await createStudent(
        result.db,
        institute.tenantId,
        `ADM-${randomUUID().slice(0, 8)}`,
      );

      expect((await mutate('deleteStudent', id)).errors).toBeUndefined();
      expect(await deletedIds('listDeletedStudents')).toContain(id);
      const hidden = await gql('query($id: ID!) { getStudent(id: $id) { id } }', { id });
      expect(hidden.errors?.[0]?.extensions?.code).toBe('STUDENT_NOT_FOUND');

      const restored = await mutate('restoreStudent', id);
      expect(restored.errors).toBeUndefined();
      expect(restored.data?.restoreStudent).toBe(true);
      expect(await deletedIds('listDeletedStudents')).not.toContain(id);
      const visible = await gql<{ getStudent: { id: string } }>(
        'query($id: ID!) { getStudent(id: $id) { id } }',
        { id },
      );
      expect(visible.errors).toBeUndefined();
      expect(visible.data?.getStudent.id).toBe(id);

      const [row] = await withAdmin(result.db, mkAdminCtx('test:people-restore'), (tx) =>
        tx
          .select({ deletedBy: studentProfiles.deletedBy, updatedBy: studentProfiles.updatedBy })
          .from(studentProfiles)
          .where(eq(studentProfiles.id, id)),
      );
      expect(row).toEqual({ deletedBy: null, updatedBy: institute.userId });
    });

    it('refuses to restore when the admission number was reissued', async () => {
      const admissionNumber = `ADM-${randomUUID().slice(0, 8)}`;
      const id = await createStudent(result.db, institute.tenantId, admissionNumber);
      expect((await mutate('deleteStudent', id)).errors).toBeUndefined();
      await createStudent(result.db, institute.tenantId, admissionNumber);

      const restored = await mutate('restoreStudent', id);
      expect(restored.errors?.[0]?.message).toContain(admissionNumber);
      expect(await deletedIds('listDeletedStudents')).toContain(id);
    });

    it('restoring a student that is not deleted returns STUDENT_NOT_FOUND', async () => {
      const id = await createStudent(
        result.db,
        institute.tenantId,
        `ADM-${randomUUID().slice(0, 8)}`,
      );
      const restored = await mutate('restoreStudent', id);
      expect(restored.errors?.[0]?.extensions?.code).toBe('STUDENT_NOT_FOUND');
    });

    it("another institute cannot see or restore this institute's deleted student", async () => {
      const id = await createStudent(
        result.db,
        institute.tenantId,
        `ADM-${randomUUID().slice(0, 8)}`,
      );
      expect((await mutate('deleteStudent', id)).errors).toBeUndefined();

      const other = await createTestInstitute(result.db);
      const otherToken = tokenFor(other);
      expect(await deletedIds('listDeletedStudents', otherToken)).not.toContain(id);
      const restored = await mutate('restoreStudent', id, otherToken);
      expect(restored.errors?.[0]?.extensions?.code).toBe('STUDENT_NOT_FOUND');
      expect(await deletedIds('listDeletedStudents')).toContain(id);
    });
  });

  describe('staff', () => {
    it('restore brings a staff member back and clears the leaving date', async () => {
      const person = await createPerson(result.db, institute.tenantId, 'Staff Member');
      const [staff] = await withAdmin(result.db, mkAdminCtx('test:people-restore'), (tx) =>
        tx
          .insert(staffProfiles)
          .values({ tenantId: institute.tenantId, ...person, employeeId: 'EMP-84', ...AUDIT })
          .returning({ id: staffProfiles.id }),
      );

      expect((await mutate('deleteStaffMember', staff.id)).errors).toBeUndefined();
      expect(await deletedIds('listDeletedStaff')).toContain(staff.id);

      const restored = await mutate('restoreStaffMember', staff.id);
      expect(restored.errors).toBeUndefined();
      expect(await deletedIds('listDeletedStaff')).not.toContain(staff.id);

      const [row] = await withAdmin(result.db, mkAdminCtx('test:people-restore'), (tx) =>
        tx
          .select({
            deletedAt: staffProfiles.deletedAt,
            dateOfLeaving: staffProfiles.dateOfLeaving,
          })
          .from(staffProfiles)
          .where(eq(staffProfiles.id, staff.id)),
      );
      expect(row).toEqual({ deletedAt: null, dateOfLeaving: null });
    });
  });

  describe('guardians', () => {
    it('a deleted guardian appears in the Deleted list and returns on restore', async () => {
      // createGuardian attaches the institute's Parent role; a test institute has none.
      await withAdmin(result.db, mkAdminCtx('test:people-restore'), (tx) =>
        tx.insert(roles).values({
          name: { en: DefaultRoles.Parent },
          scope: 'institute',
          tenantId: institute.tenantId,
          abilities: [],
          isDefault: false,
          isSystem: false,
          ...AUDIT,
        }),
      );
      const created = await gql<{ createGuardian: { id: string } }>(
        'mutation($input: CreateGuardianInput!) { createGuardian(input: $input) { id } }',
        { input: { firstName: { en: 'Ramesh' } } },
      );
      expect(created.errors).toBeUndefined();
      assert(created.data);
      const id = created.data.createGuardian.id;

      expect((await mutate('deleteGuardian', id)).errors).toBeUndefined();
      expect(await deletedIds('listDeletedGuardians')).toContain(id);

      expect((await mutate('restoreGuardian', id)).errors).toBeUndefined();
      expect(await deletedIds('listDeletedGuardians')).not.toContain(id);
      const visible = await gql<{ getGuardian: { id: string } }>(
        'query($id: ID!) { getGuardian(id: $id) { id } }',
        { id },
      );
      expect(visible.errors).toBeUndefined();
    });
  });

  describe('authorization', () => {
    it.each([
      'listDeletedStudents',
      'listDeletedStaff',
      'listDeletedGuardians',
    ])('%s rejects a platform-scope token', async (field) => {
      const platformToken = createPlatformToken({
        sub: FAKE.USER,
        membershipId: FAKE.MEMBERSHIP,
        roleId: FAKE.ROLE,
      });
      const response = await gql(`query { ${field} { id } }`, {}, platformToken);
      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('a teacher cannot list or restore deleted students', async () => {
      const teacher = await createTestTeacher(result.db, institute.tenantId);
      const teacherToken = createInstituteToken({
        sub: teacher.userId,
        tenantId: institute.tenantId,
        membershipId: teacher.membershipId,
        roleId: teacher.roleId,
      });
      const listed = await gql('query { listDeletedStudents { id } }', {}, teacherToken);
      expect(listed.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      const restored = await mutate('restoreStudent', randomUUID(), teacherToken);
      expect(restored.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });
});
