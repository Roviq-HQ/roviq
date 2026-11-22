import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  type AbilityRule,
  DEFAULT_ROLE_ABILITIES,
  type DefaultRole,
  Gender,
  GuardianRelationship,
} from '@roviq/common-types';
import {
  academicYears,
  admissionApplications,
  enquiries,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentGuardianLinks,
  studentProfiles,
  tenantUserProfiles,
  userProfiles,
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
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app/app.module';

interface Actor extends TestTeacher {
  token: string;
}
interface StudentNode {
  id: string;
  firstName: { en: string };
  admissionNumber: string | null;
  academicStatus: string | null;
  userId: string | null;
  medicalInfo: { allergies: string[] } | null;
}
interface StudentPage {
  edges: { node: StudentNode }[];
  totalCount: number;
}

describe('ROV-204 student read authorization through GraphQL and PostgreSQL', () => {
  let app: IntegrationAppResult;
  let tenant: TestInstitute;
  let foreignTenant: TestInstitute;
  const actors: Actor[] = [];
  const studentIds: string[] = [];
  const guardianIds: string[] = [];
  let otherGuardian: Actor;
  let sharedGuardian: Actor;
  let foreignGuardian: Actor;
  let basicGuardianReader: Actor;
  let teacher: Actor;
  let unassigned: Actor;
  let student: Actor;
  let parent: Actor;
  let nurse: Actor;
  let receptionist: Actor;
  let support: Actor;
  let principal: Actor;
  let clerk: Actor;
  let applicationId: string;
  let limitedAdmissions: Actor;
  let hiddenApplicationId: string;
  let enquiryId: string;

  async function actor(
    role: DefaultRole,
    institute = tenant,
    abilities?: AbilityRule[],
  ): Promise<Actor> {
    const record = await createTestTeacher(app.db, institute.tenantId);
    await withAdmin(app.db, mkAdminCtx('test:student-read-authorization'), async (tx) => {
      await tx
        .update(roles)
        .set({ abilities: abilities ?? DEFAULT_ROLE_ABILITIES[role] })
        .where(eq(roles.id, record.roleId));
      await tx
        .update(memberships)
        .set({ abilities: [] })
        .where(eq(memberships.id, record.membershipId));
    });
    const result = {
      ...record,
      token: createInstituteToken({
        sub: record.userId,
        membershipId: record.membershipId,
        roleId: record.roleId,
        tenantId: institute.tenantId,
      }),
    };
    actors.push(result);
    return result;
  }

  async function createEnquiries(tx: import('@roviq/database').DrizzleDB) {
    for (const assignedTo of [limitedAdmissions.userId, clerk.userId]) {
      const [enquiry] = await tx
        .insert(enquiries)
        .values({
          tenantId: tenant.tenantId,
          studentName: 'Test applicant',
          classRequested: '5',
          parentName: 'Test parent',
          parentPhone: '9000000000',
          assignedTo,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning();
      if (assignedTo === limitedAdmissions.userId) enquiryId = enquiry.id;
    }
  }

  async function createGuardians(tx: import('@roviq/database').DrizzleDB) {
    for (const [person, children] of [
      [parent, [studentIds[0]]],
      [otherGuardian, [studentIds[1]]],
      [sharedGuardian, [studentIds[0], studentIds[1]]],
      [foreignGuardian, [studentIds[2]]],
    ] as const) {
      const tenantId = person === foreignGuardian ? foreignTenant.tenantId : tenant.tenantId;
      await tx.insert(userProfiles).values({
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        userId: person.userId,
        firstName: { en: 'Test guardian' },
      });
      await tx.insert(tenantUserProfiles).values({
        tenantId: tenantId,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        userId: person.userId,
        firstName: { en: 'Test guardian' },
      });
      const [guardian] = await tx
        .insert(guardianProfiles)
        .values({
          tenantId,
          userId: person.userId,
          membershipId: person.membershipId,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning();
      guardianIds.push(guardian.id);
      await tx.insert(studentGuardianLinks).values(
        children.map((studentProfileId) => ({
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          tenantId,
          guardianProfileId: guardian.id,
          studentProfileId,
          relationship: GuardianRelationship.FATHER,
        })),
      );
    }
  }

  beforeAll(async () => {
    assert.equal(new URL(process.env.DATABASE_URL_TEST ?? '').pathname, '/roviq_test');
    app = await createIntegrationApp({ modules: [AppModule] });
    tenant = await createTestInstitute(app.db);
    foreignTenant = await createTestInstitute(app.db);
    teacher = await actor('class_teacher');
    unassigned = await actor('class_teacher');
    student = await actor('student');
    const otherStudent = await actor('student');
    const foreignStudent = await actor('student', foreignTenant);
    parent = await actor('parent');
    otherGuardian = await actor('parent');
    sharedGuardian = await actor('parent');
    foreignGuardian = await actor('parent', foreignTenant);
    basicGuardianReader = await actor('nurse', tenant, [
      ...DEFAULT_ROLE_ABILITIES.nurse,
      { action: 'read', subject: 'Guardian' },
    ]);
    nurse = await actor('nurse');
    receptionist = await actor('receptionist');
    support = await actor('support_staff');
    principal = await actor('principal');
    clerk = await actor('admin_clerk');
    limitedAdmissions = await actor('receptionist', tenant, [
      ...DEFAULT_ROLE_ABILITIES.principal,
      { action: 'read', subject: 'Application', conditions: { createdBy: '$user.sub' } },
      { action: 'read', subject: 'Enquiry', conditions: { assignedTo: '$user.sub' } },
    ]);

    await withAdmin(app.db, mkAdminCtx('test:student-read-authorization'), async (tx) => {
      const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
      for (const [institute, people] of [
        [tenant, [student, otherStudent]],
        [foreignTenant, [foreignStudent]],
      ] as const) {
        const [year] = await tx
          .insert(academicYears)
          .values({
            tenantId: institute.tenantId,
            label: '2026-27',
            startDate: '2026-04-01',
            endDate: '2027-03-31',
            isActive: true,
            status: 'ACTIVE',
            ...by,
          })
          .returning();
        const [standard] = await tx
          .insert(standards)
          .values({
            tenantId: institute.tenantId,
            academicYearId: year.id,
            name: { en: 'Test standard' },
            numericOrder: 5,
            ...by,
          })
          .returning();
        for (const [index, person] of people.entries()) {
          const [section] = await tx
            .insert(sections)
            .values({
              tenantId: institute.tenantId,
              academicYearId: year.id,
              standardId: standard.id,
              name: { en: `Section ${index}` },
              classTeacherId: institute === tenant && index === 0 ? teacher.membershipId : null,
              ...by,
            })
            .returning();
          await tx.insert(userProfiles).values({
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
            userId: person.userId,
            firstName: { en: `Student ${index}` },
            gender: Gender.MALE,
          });
          await tx.insert(tenantUserProfiles).values({
            tenantId: institute.tenantId,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
            userId: person.userId,
            firstName: { en: `Student ${index}` },
            gender: Gender.MALE,
          });
          const [profile] = await tx
            .insert(studentProfiles)
            .values({
              tenantId: institute.tenantId,
              userId: person.userId,
              membershipId: person.membershipId,
              admissionNumber: `TEST-${index}`,
              admissionDate: '2026-04-01',
              medicalInfo: { allergies: ['confidential'] },
              ...by,
            })
            .returning();
          studentIds.push(profile.id);
          await tx.insert(studentAcademics).values({
            tenantId: institute.tenantId,
            studentProfileId: profile.id,
            academicYearId: year.id,
            standardId: standard.id,
            sectionId: section.id,
            ...by,
          });
        }
        if (institute === tenant) {
          const [application] = await tx
            .insert(admissionApplications)
            .values({
              tenantId: institute.tenantId,
              academicYearId: year.id,
              standardId: standard.id,
              formData: {
                aadhaar: '1234',
                annual_income: 50000,
                medicalInfo: { allergies: ['secret'] },
              },
              ...by,
            })
            .returning();
          hiddenApplicationId = application.id;
          const [visible] = await tx
            .insert(admissionApplications)
            .values({
              tenantId: institute.tenantId,
              academicYearId: year.id,
              standardId: standard.id,
              formData: application.formData,
              ...by,
              createdBy: limitedAdmissions.userId,
            })
            .returning();
          applicationId = visible.id;
          await createEnquiries(tx);
        }
      }
      await createGuardians(tx);
    });
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    if (tenant && foreignTenant) {
      await withAdmin(app.db, mkAdminCtx('test:student-read-authorization'), async (tx) => {
        const tenantIds = [tenant.tenantId, foreignTenant.tenantId];
        await tx
          .delete(admissionApplications)
          .where(inArray(admissionApplications.tenantId, tenantIds));
        await tx.delete(enquiries).where(inArray(enquiries.tenantId, tenantIds));
        await tx
          .delete(studentGuardianLinks)
          .where(inArray(studentGuardianLinks.tenantId, tenantIds));
        await tx.delete(guardianProfiles).where(inArray(guardianProfiles.tenantId, tenantIds));
        await tx.delete(studentAcademics).where(inArray(studentAcademics.tenantId, tenantIds));
        await tx.delete(studentProfiles).where(inArray(studentProfiles.tenantId, tenantIds));
        await tx.delete(sections).where(inArray(sections.tenantId, tenantIds));
        await tx.delete(standards).where(inArray(standards.tenantId, tenantIds));
        await tx.delete(academicYears).where(inArray(academicYears.tenantId, tenantIds));
        await tx.delete(tenantUserProfiles).where(
          inArray(
            tenantUserProfiles.userId,
            actors.map((entry) => entry.userId),
          ),
        );
        await tx.delete(userProfiles).where(
          inArray(
            userProfiles.userId,
            actors.map((entry) => entry.userId),
          ),
        );
      });
    }
    for (const entry of actors.reverse()) await cleanupTestTeacher(app.db, entry);
    if (tenant) await cleanupTestInstitute(app.db, tenant);
    if (foreignTenant) await cleanupTestInstitute(app.db, foreignTenant);
    await app.close();
  });

  async function list(person: Actor) {
    const response = await gqlRequest<{ listStudents: StudentPage }>(app.httpServer, {
      token: person.token,
      query:
        '{ listStudents { totalCount edges { node { id firstName admissionNumber academicStatus userId medicalInfo { allergies } } } } }',
    });
    expect(response.errors).toBeUndefined();
    assert(response.data);
    return response.data.listStudents;
  }

  it('teacher sees only assigned students in rows and counts', async () => {
    const page = await list(teacher);
    expect(page.totalCount).toBe(1);
    expect(page.edges.map((edge) => edge.node.id)).toEqual([studentIds[0]]);
    expect(page.edges[0].node.medicalInfo).toBeNull();
    const response = await gqlRequest<{ studentStatistics: { total: number } }>(app.httpServer, {
      token: teacher.token,
      query: '{ studentStatistics { total } }',
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.studentStatistics.total).toBe(1);
  });

  it('teacher without assignments sees zero rows', async () => {
    expect(await list(unassigned)).toEqual({ totalCount: 0, edges: [] });
  });

  it.each([
    'student',
    'parent',
  ] as const)('%s sees only their own or linked student', async (role) => {
    const page = await list(role === 'student' ? student : parent);
    expect(page.totalCount).toBe(1);
    expect(page.edges.map((edge) => edge.node.id)).toEqual([studentIds[0]]);
  });

  it('direct lookup cannot bypass section or tenant scope', async () => {
    for (const id of studentIds.slice(1)) {
      const response = await gqlRequest(app.httpServer, {
        token: teacher.token,
        query: 'query($id: ID!) { getStudent(id: $id) { id firstName } }',
        variables: { id },
      });
      expect(response.errors?.map((error) => error.extensions?.code)).toEqual([
        'STUDENT_NOT_FOUND',
      ]);
    }
  });

  it('basic roles receive only their permitted fields', async () => {
    const nursePage = await list(nurse);
    expect(nursePage.totalCount).toBe(2);
    expect(nursePage.edges[0].node.medicalInfo).toEqual({ allergies: ['confidential'] });
    expect(nursePage.edges[0].node.admissionNumber).toBeNull();
    expect(nursePage.edges[0].node.userId).toBeNull();
    const receptionPage = await list(receptionist);
    expect(receptionPage.edges[0].node.admissionNumber).not.toBeNull();
    expect(receptionPage.edges[0].node.medicalInfo).toBeNull();
    const supportPage = await list(support);
    expect(supportPage.edges[0].node.admissionNumber).toBeNull();
    expect(supportPage.edges[0].node.medicalInfo).toBeNull();
  });

  it('restricted fields cannot be inferred using list filters', async () => {
    const response = await gqlRequest(app.httpServer, {
      token: nurse.token,
      query: '{ listStudents(filter: { socialCategory: GENERAL }) { totalCount } }',
    });
    expect(response.errors?.map((error) => error.extensions?.code)).toEqual(['FORBIDDEN']);
  });

  it('keeps admin_clerk access while principal medical data is masked', async () => {
    expect((await list(clerk)).edges[0].node.medicalInfo).toEqual({ allergies: ['confidential'] });
    expect((await list(principal)).edges[0].node.medicalInfo).toBeNull();
  });

  it('preserves admin_clerk sensitive application JSON', async () => {
    const response = await gqlRequest<{ getApplication: { formData: Record<string, unknown> } }>(
      app.httpServer,
      {
        token: clerk.token,
        query: 'query($id: ID!) { getApplication(id: $id) { formData } }',
        variables: { id: applicationId },
      },
    );
    expect(response.errors).toBeUndefined();
    expect(response.data?.getApplication.formData).toEqual({
      aadhaar: '1234',
      annual_income: 50000,
      medicalInfo: { allergies: ['secret'] },
    });
  });
  it('applies conditional application access to rows, counts, lookup and JSON fields', async () => {
    const response = await gqlRequest<{
      listApplications: {
        totalCount: number;
        edges: { node: { id: string; formData: Record<string, unknown> } }[];
      };
    }>(app.httpServer, {
      token: limitedAdmissions.token,
      query: '{ listApplications { totalCount edges { node { id formData } } } }',
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.listApplications).toEqual({
      totalCount: 1,
      edges: [{ node: { id: applicationId, formData: { aadhaar: '1234' } } }],
    });
    const denied = await gqlRequest(app.httpServer, {
      token: limitedAdmissions.token,
      query: 'query($id: ID!) { getApplication(id: $id) { id } }',
      variables: { id: hiddenApplicationId },
    });
    expect(denied.errors?.map((error) => error.message)).toEqual(['Application not found']);
    expect(denied.data).toBeNull();
  });

  it('applies conditional enquiry access to both rows and counts', async () => {
    const response = await gqlRequest<{
      listEnquiries: { totalCount: number; edges: { node: { id: string } }[] };
    }>(app.httpServer, {
      token: limitedAdmissions.token,
      query: '{ listEnquiries { totalCount edges { node { id } } } }',
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.listEnquiries).toEqual({
      totalCount: 1,
      edges: [{ node: { id: enquiryId } }],
    });
  });
  it('masks sensitive fields in mutation responses', async () => {
    const current = await gqlRequest<{ getStudent: { version: number } }>(app.httpServer, {
      token: principal.token,
      query: 'query($id: ID!) { getStudent(id: $id) { version } }',
      variables: { id: studentIds[0] },
    });
    expect(current.errors).toBeUndefined();
    assert(current.data);
    const response = await gqlRequest<{ updateStudent: { id: string; medicalInfo: unknown } }>(
      app.httpServer,
      {
        token: principal.token,
        query:
          'mutation($id: ID!, $input: UpdateStudentInput!) { updateStudent(id: $id, input: $input) { id medicalInfo { allergies } } }',
        variables: {
          id: studentIds[0],
          input: { version: current.data.getStudent.version, bloodGroup: 'O+' },
        },
      },
    );
    expect(response.errors).toBeUndefined();
    expect(response.data?.updateStudent).toEqual({ id: studentIds[0], medicalInfo: null });
  });

  it('blocks document and academic-history lookup outside the readable rows', async () => {
    for (const field of ['listStudentDocuments', 'listStudentAcademics']) {
      const response = await gqlRequest(app.httpServer, {
        token: teacher.token,
        query: `query($id: ID!) { ${field}(studentProfileId: $id) { id } }`,
        variables: { id: studentIds[1] },
      });
      expect(response.errors?.map((error) => error.extensions?.code)).toEqual([
        'STUDENT_NOT_FOUND',
      ]);
    }
  });

  it('scopes guardian lists and linked-child counts to assigned sections', async () => {
    const response = await gqlRequest<{
      listGuardians: { id: string; linkedStudentCount: number }[];
    }>(app.httpServer, {
      token: teacher.token,
      query: '{ listGuardians { id linkedStudentCount } }',
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.listGuardians.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [guardianIds[0], guardianIds[2]].sort().map((id) => ({ id, linkedStudentCount: 1 })),
    );
    const empty = await gqlRequest<{ listGuardians: unknown[] }>(app.httpServer, {
      token: unassigned.token,
      query: '{ listGuardians { id } }',
    });
    expect(empty.errors).toBeUndefined();
    expect(empty.data?.listGuardians).toEqual([]);
  });

  it('prevents sibling and contact lookups from bypassing guardian section scope', async () => {
    const response = await gqlRequest<{ listLinkedStudents: { studentProfileId: string }[] }>(
      app.httpServer,
      {
        token: teacher.token,
        query:
          'query($id: ID!) { listLinkedStudents(guardianProfileId: $id) { studentProfileId } }',
        variables: { id: guardianIds[2] },
      },
    );
    expect(response.errors).toBeUndefined();
    expect(response.data?.listLinkedStudents).toEqual([{ studentProfileId: studentIds[0] }]);
    const contacts = await gqlRequest<{ listStudentGuardians: unknown[] }>(app.httpServer, {
      token: teacher.token,
      query:
        'query($id: ID!) { listStudentGuardians(studentProfileId: $id) { guardianProfileId } }',
      variables: { id: studentIds[1] },
    });
    expect(contacts.errors).toBeUndefined();
    expect(contacts.data?.listStudentGuardians).toEqual([]);
    for (const id of [guardianIds[1], guardianIds[3]]) {
      const denied = await gqlRequest(app.httpServer, {
        token: teacher.token,
        query: 'query($id: ID!) { getGuardian(id: $id) { id primaryPhone } }',
        variables: { id },
      });
      expect(denied.errors?.map((error) => error.message)).toEqual([
        `Guardian profile ${id} not found`,
      ]);
      expect(denied.data).toBeNull();
    }
  });

  it('masks student fields when read through guardian links', async () => {
    const response = await gqlRequest<{
      listLinkedStudents: {
        studentProfileId: string;
        admissionNumber: string | null;
        currentSectionName: unknown;
      }[];
    }>(app.httpServer, {
      token: basicGuardianReader.token,
      query:
        'query($id: ID!) { listLinkedStudents(guardianProfileId: $id) { studentProfileId admissionNumber currentSectionName } }',
      variables: { id: guardianIds[2] },
    });
    expect(response.errors).toBeUndefined();
    expect(
      response.data?.listLinkedStudents.sort((a, b) =>
        a.studentProfileId.localeCompare(b.studentProfileId),
      ),
    ).toEqual(
      studentIds
        .slice(0, 2)
        .sort()
        .map((studentProfileId) => ({
          studentProfileId,
          admissionNumber: null,
          currentSectionName: null,
        })),
    );
  });

  it('revokes parent visibility as soon as the guardian link is removed', async () => {
    await withAdmin(app.db, mkAdminCtx('test:student-read-authorization'), async (tx) => {
      await tx
        .delete(studentGuardianLinks)
        .where(eq(studentGuardianLinks.studentProfileId, studentIds[0]));
    });
    expect(await list(parent)).toEqual({ totalCount: 0, edges: [] });
  });

  it('migrates default policies idempotently while preserving clerk and custom roles', async () => {
    const migration = await readFile(
      'libs/database/migrations/20261114164236_rov-204-read-permissions/migration.sql',
      'utf8',
    );
    await withAdmin(app.db, mkAdminCtx('test:student-read-authorization'), async (tx) => {
      await tx.execute(sql`SAVEPOINT policy_migration`);
      try {
        for (const [person, name, isDefault] of [
          [principal, 'principal', true],
          [parent, 'parent', true],
          [clerk, 'admin_clerk', true],
          [unassigned, 'subject_teacher', false],
        ] as const) {
          const abilities = DEFAULT_ROLE_ABILITIES[name]
            .filter((rule) => !rule.inverted)
            .map((rule) =>
              name === 'parent' && rule.subject === 'Student'
                ? { ...rule, conditions: undefined }
                : rule,
            );
          await tx
            .update(roles)
            .set({ name: { en: name }, isDefault, abilities })
            .where(eq(roles.id, person.roleId));
        }
        const ids = [principal, parent, clerk, unassigned].map((person) => person.roleId);
        const before = await tx.select().from(roles).where(inArray(roles.id, ids));
        await tx.execute(sql.raw(migration));
        const after = await tx.select().from(roles).where(inArray(roles.id, ids));
        for (const person of [clerk, unassigned]) {
          expect(after.find((role) => role.id === person.roleId)).toEqual(
            before.find((role) => role.id === person.roleId),
          );
        }
        expect(after.find((role) => role.id === principal.roleId)?.abilities).toEqual(
          DEFAULT_ROLE_ABILITIES.principal,
        );
        expect(after.find((role) => role.id === parent.roleId)?.abilities).toEqual(
          DEFAULT_ROLE_ABILITIES.parent,
        );
        await tx.execute(sql.raw(migration));
        expect(await tx.select().from(roles).where(inArray(roles.id, ids))).toEqual(after);
      } finally {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT policy_migration`);
      }
    });
  });
});
