/**
 * ROV-167 — Integration tests for student detail operations.
 *
 * Covers getStudent, updateStudent optimistic concurrency,
 * transitionStudentStatus (valid + invalid), listStudentAcademics,
 * listStudentDocuments, and listStudentGuardians against a fresh
 * test institute with a minimal student fixture.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  DomainGroupType,
  Gender,
  GroupMembershipType,
  SocialCategory,
} from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  groupRules,
  groups,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS, eventPayloadSchemas } from '@roviq/nats-jetstream';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { GroupInvalidationHandler } from '../../group/group-invalidation.handler';

interface StudentFixture {
  studentProfileId: string;
  admissionNumber: string;
  academicYearId: string;
}

/**
 * Insert the minimum viable rows to satisfy:
 *   student_profiles → users, memberships, user_profiles
 *   student_academics → student_profiles, academic_years, standards, sections
 *
 * Uses `withAdmin` to bypass RLS — same pattern production admin tooling uses.
 */
async function createStudentFixture(db: DrizzleDB, tenantId: string): Promise<StudentFixture> {
  const suffix = randomUUID().slice(0, 8);
  const admissionNumber = `ADM-${suffix}`;

  return withAdmin(db, mkAdminCtx('test:student-detail'), async (tx) => {
    // Academic year (active).
    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId,
        label: '2025-26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        isActive: false,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: academicYears.id });

    // Standard.
    const [std] = await tx
      .insert(standards)
      .values({
        tenantId,
        academicYearId: year.id,
        name: { en: 'Class 5' },
        numericOrder: 5,
        level: 'PRIMARY',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: standards.id });

    // Section.
    const [sec] = await tx
      .insert(sections)
      .values({
        tenantId,
        standardId: std.id,
        academicYearId: year.id,
        name: { en: 'A' },
        displayLabel: 'Class 5-A',
        capacity: 40,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: sections.id });

    // User + user_profile.
    const [user] = await tx
      .insert(users)
      .values({
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        email: `student_${suffix}@test.local`,
        username: `stu_${suffix}`,
        passwordHash: 'not-a-real-hash',
      })
      .returning({ id: users.id });

    await tx.insert(userProfiles).values({
      userId: user.id,
      firstName: { en: `Student ${suffix}` },
      lastName: { en: 'Kumar' },
      gender: Gender.MALE,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await tx.insert(tenantUserProfiles).values({
      tenantId: tenantId,
      userId: user.id,
      firstName: { en: `Student ${suffix}` },
      lastName: { en: 'Kumar' },
      gender: Gender.MALE,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // Student role + membership (required by student_profiles.membership_id FK).
    const [role] = await tx
      .insert(roles)
      .values({
        name: { en: `Student Role ${suffix}` },
        scope: 'institute',
        tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: roles.id });

    const [membership] = await tx
      .insert(memberships)
      .values({
        userId: user.id,
        roleId: role.id,
        tenantId,
        abilities: [],
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: memberships.id });

    // student_profiles row.
    const [profile] = await tx
      .insert(studentProfiles)
      .values({
        tenantId,
        userId: user.id,
        membershipId: membership.id,
        admissionNumber,
        admissionDate: '2025-04-01',
        admissionType: AdmissionType.NEW,
        academicStatus: AcademicStatus.ENROLLED,
        socialCategory: SocialCategory.GENERAL,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: studentProfiles.id });

    // student_academics row so listStudentAcademics returns >= 1.
    await tx.insert(studentAcademics).values({
      tenantId,
      studentProfileId: profile.id,
      academicYearId: year.id,
      standardId: std.id,
      sectionId: sec.id,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    return { studentProfileId: profile.id, admissionNumber, academicYearId: year.id };
  });
}

describe('Student detail operations (integration)', () => {
  let result: IntegrationAppResult;
  let instituteToken: string;
  let fixture: StudentFixture;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    const institute = await createTestInstitute(result.db);
    instituteToken = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
    fixture = await createStudentFixture(result.db, institute.tenantId);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('getStudent returns the student with joined fields', async () => {
    const response = await gqlRequest<{ getStudent: { id: string; admissionNumber: string } }>(
      result.httpServer,
      {
        query: /* GraphQL */ `
          query GetStudent($id: ID!) {
            getStudent(id: $id) {
              id
              admissionNumber
              academicStatus
              firstName
              version
            }
          }
        `,
        token: instituteToken,
        variables: { id: fixture.studentProfileId },
      },
    );
    expect(response.errors).toBeUndefined();
    expect(response.data?.getStudent.id).toBe(fixture.studentProfileId);
    expect(response.data?.getStudent.admissionNumber).toBe(fixture.admissionNumber);
  });

  it('updateStudent with stale version throws CONCURRENT_MODIFICATION', async () => {
    const response = await gqlRequest(result.httpServer, {
      query: /* GraphQL */ `
        mutation UpdateStudent($id: ID!, $input: UpdateStudentInput!) {
          updateStudent(id: $id, input: $input) {
            id
          }
        }
      `,
      token: instituteToken,
      variables: {
        id: fixture.studentProfileId,
        input: { version: 9999, firstName: { en: 'Stale Update' } },
      },
    });
    expect(response.errors).toBeDefined();
    expect(response.errors?.[0]?.extensions?.code).toBe('CONCURRENT_MODIFICATION');
  });

  it('transitionStudentStatus enrolled→promoted succeeds', async () => {
    const response = await gqlRequest<{
      transitionStudentStatus: { id: string; academicStatus: string };
    }>(result.httpServer, {
      query: /* GraphQL */ `
          mutation Transition($id: ID!, $newStatus: AcademicStatus!) {
            transitionStudentStatus(id: $id, newStatus: $newStatus) {
              id
              academicStatus
            }
          }
        `,
      token: instituteToken,
      variables: { id: fixture.studentProfileId, newStatus: AcademicStatus.PROMOTED },
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.transitionStudentStatus.academicStatus).toBe(AcademicStatus.PROMOTED);
  });

  it('transitionStudentStatus promoted→detained is rejected with INVALID_STATE_TRANSITION', async () => {
    // Previous test left the fixture student in `promoted`. Only `enrolled`
    // is a valid next state — `detained` is NOT.
    const response = await gqlRequest(result.httpServer, {
      query: /* GraphQL */ `
        mutation Transition($id: ID!, $newStatus: AcademicStatus!) {
          transitionStudentStatus(id: $id, newStatus: $newStatus) {
            id
          }
        }
      `,
      token: instituteToken,
      variables: { id: fixture.studentProfileId, newStatus: AcademicStatus.DETAINED },
    });
    expect(response.errors).toBeDefined();
    expect(response.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('listStudentAcademics returns at least one row for the fixture student', async () => {
    const response = await gqlRequest<{ listStudentAcademics: ReadonlyArray<{ id: string }> }>(
      result.httpServer,
      {
        query: /* GraphQL */ `
          query ListAcademics($studentProfileId: ID!) {
            listStudentAcademics(studentProfileId: $studentProfileId) {
              id
              academicYearId
            }
          }
        `,
        token: instituteToken,
        variables: { studentProfileId: fixture.studentProfileId },
      },
    );
    expect(response.errors).toBeUndefined();
    expect(response.data?.listStudentAcademics.length).toBeGreaterThanOrEqual(1);
  });

  it('listStudentDocuments returns [] for a student with no docs', async () => {
    // This exercises the withTenant → withAdmin bridge (documents live on
    // platform-level user_documents) without any real document rows.
    const response = await gqlRequest<{ listStudentDocuments: ReadonlyArray<unknown> }>(
      result.httpServer,
      {
        query: /* GraphQL */ `
          query ListDocs($studentProfileId: ID!) {
            listStudentDocuments(studentProfileId: $studentProfileId) {
              id
            }
          }
        `,
        token: instituteToken,
        variables: { studentProfileId: fixture.studentProfileId },
      },
    );
    expect(response.errors).toBeUndefined();
    expect(response.data?.listStudentDocuments).toEqual([]);
  });

  it('listStudentGuardians returns linked guardians (empty array when none)', async () => {
    const response = await gqlRequest<{ listStudentGuardians: ReadonlyArray<unknown> }>(
      result.httpServer,
      {
        query: /* GraphQL */ `
          query ListGuardians($studentProfileId: ID!) {
            listStudentGuardians(studentProfileId: $studentProfileId) {
              linkId
            }
          }
        `,
        token: instituteToken,
        variables: { studentProfileId: fixture.studentProfileId },
      },
    );
    expect(response.errors).toBeUndefined();
    expect(Array.isArray(response.data?.listStudentGuardians)).toBe(true);
  });
});

describe('Student status changes and dynamic groups (integration)', () => {
  let result: IntegrationAppResult;
  let groupHandler: GroupInvalidationHandler;
  let other: TestInstitute;

  const ORIGIN = 'test:student-detail';
  const tokenFor = (i: TestInstitute) =>
    createInstituteToken({
      sub: i.userId,
      tenantId: i.tenantId,
      membershipId: i.membershipId,
      roleId: i.roleId,
    });

  const TRANSITION = /* GraphQL */ `
    mutation Transition($id: ID!, $newStatus: AcademicStatus!) {
      transitionStudentStatus(id: $id, newStatus: $newStatus) { id academicStatus }
    }`;
  const UPDATE = /* GraphQL */ `
    mutation Update($id: ID!, $input: UpdateStudentInput!) {
      updateStudent(id: $id, input: $input) { id academicStatus }
    }`;

  /** One group per dimension the handler must tell apart, all resolved. */
  const addGroups = (tenantId: string) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), async (tx) => {
      const audit = { tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
      const [byStatus, byStandard, bySection, byGender] = await tx
        .insert(groups)
        .values(
          ['By status', 'By standard', 'By section', 'By gender'].map((name) => ({
            ...audit,
            name: `${name} ${randomUUID().slice(0, 8)}`,
            groupType: DomainGroupType.CLUB,
            membershipType: GroupMembershipType.DYNAMIC,
            resolvedAt: new Date(),
          })),
        )
        .returning({ id: groups.id });
      await tx.insert(groupRules).values([
        {
          ...audit,
          groupId: byStatus.id,
          rule: { '==': [{ var: 'academic_status' }, AcademicStatus.PROMOTED] },
          ruleDimensions: ['academic_status'],
        },
        {
          ...audit,
          groupId: byStandard.id,
          rule: { '==': [{ var: 'standard_id' }, randomUUID()] },
          ruleDimensions: ['standard_id'],
        },
        {
          ...audit,
          groupId: bySection.id,
          rule: { '==': [{ var: 'section_id' }, randomUUID()] },
          ruleDimensions: ['section_id'],
        },
        {
          ...audit,
          groupId: byGender.id,
          rule: { '==': [{ var: 'gender' }, Gender.FEMALE] },
          ruleDimensions: ['gender'],
        },
      ]);
      return {
        byStatus: byStatus.id,
        byStandard: byStandard.id,
        bySection: bySection.id,
        byGender: byGender.id,
      };
    });

  const stateOf = async (ids: string[]) => {
    const rows = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ id: groups.id, resolvedAt: groups.resolvedAt })
        .from(groups)
        .where(inArray(groups.id, ids)),
    );
    return new Map(rows.map((r) => [r.id, r.resolvedAt === null ? 'unresolved' : 'resolved']));
  };

  const statusOf = async (studentProfileId: string) => {
    const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ status: studentProfiles.academicStatus, version: studentProfiles.version })
        .from(studentProfiles)
        .where(eq(studentProfiles.id, studentProfileId)),
    );
    assert(row, `fixture: no student_profiles ${studentProfileId}`);
    return row;
  };

  const emitted = (spy: ReturnType<typeof vi.spyOn>, pattern: string) =>
    spy.mock.calls.filter(([p]) => p === pattern).map(([, payload]) => payload);

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    groupHandler = result.app.get(GroupInvalidationHandler);
    other = await createTestInstitute(result.db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should emit STUDENT.statusChanged once, from ENROLLED to PROMOTED, on transitionStudentStatus', async () => {
    const inst = await createTestInstitute(result.db);
    const student = await createStudentFixture(result.db, inst.tenantId);
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    const response = await gqlRequest(result.httpServer, {
      query: TRANSITION,
      token: tokenFor(inst),
      variables: { id: student.studentProfileId, newStatus: AcademicStatus.PROMOTED },
    });

    expect(response.errors).toBeUndefined();
    expect(emitted(emit, EVENT_PATTERNS.STUDENT.statusChanged)).toEqual([
      {
        studentProfileId: student.studentProfileId,
        fromStatus: AcademicStatus.ENROLLED,
        toStatus: AcademicStatus.PROMOTED,
        reason: null,
        tenantId: inst.tenantId,
      },
    ]);
    expect(emitted(emit, EVENT_PATTERNS.STUDENT.promoted)).toEqual([]);
    expect(emitted(emit, EVENT_PATTERNS.STUDENT.left)).toEqual([]);
  });

  it('should mark only academic_status groups of this institute unresolved', async () => {
    const inst = await createTestInstitute(result.db);
    const student = await createStudentFixture(result.db, inst.tenantId);
    const mine = await addGroups(inst.tenantId);
    const theirs = await addGroups(other.tenantId);
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    await gqlRequest(result.httpServer, {
      query: TRANSITION,
      token: tokenFor(inst),
      variables: { id: student.studentProfileId, newStatus: AcademicStatus.PROMOTED },
    });
    const [payload] = emitted(emit, EVENT_PATTERNS.STUDENT.statusChanged);
    await groupHandler.onStudentStatusChanged(payload);

    expect(await stateOf([...Object.values(mine), ...Object.values(theirs)])).toEqual(
      new Map([
        [mine.byStatus, 'unresolved'],
        [mine.byStandard, 'resolved'],
        [mine.bySection, 'resolved'],
        [mine.byGender, 'resolved'],
        [theirs.byStatus, 'resolved'],
        [theirs.byStandard, 'resolved'],
        [theirs.bySection, 'resolved'],
        [theirs.byGender, 'resolved'],
      ]),
    );
  });

  it('should mark only the gender groups of this institute unresolved when updateStudent edits gender', async () => {
    const inst = await createTestInstitute(result.db);
    const student = await createStudentFixture(result.db, inst.tenantId);
    const { version } = await statusOf(student.studentProfileId);
    const mine = await addGroups(inst.tenantId);
    const theirs = await addGroups(other.tenantId);
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    const response = await gqlRequest(result.httpServer, {
      query: UPDATE,
      token: tokenFor(inst),
      variables: {
        id: student.studentProfileId,
        input: { version, gender: Gender.FEMALE, firstName: { en: 'Asha' } },
      },
    });
    expect(response.errors).toBeUndefined();
    const updates = emitted(emit, EVENT_PATTERNS.STUDENT.updated);
    expect(updates).toHaveLength(1);
    const [payload] = updates;
    expect(
      eventPayloadSchemas[EVENT_PATTERNS.STUDENT.updated].parse(payload).changedFields.sort(),
    ).toEqual(['firstName', 'gender']);
    expect(emitted(emit, EVENT_PATTERNS.STUDENT.statusChanged)).toEqual([]);

    await groupHandler.onStudentUpdated(payload);

    expect(await stateOf([...Object.values(mine), ...Object.values(theirs)])).toEqual(
      new Map([
        [mine.byStatus, 'resolved'],
        [mine.byStandard, 'resolved'],
        [mine.bySection, 'resolved'],
        [mine.byGender, 'unresolved'],
        [theirs.byStatus, 'resolved'],
        [theirs.byStandard, 'resolved'],
        [theirs.bySection, 'resolved'],
        [theirs.byGender, 'resolved'],
      ]),
    );
  });

  it('should leave every group resolved when updateStudent edits only fields no rule uses', async () => {
    const inst = await createTestInstitute(result.db);
    const student = await createStudentFixture(result.db, inst.tenantId);
    const { version } = await statusOf(student.studentProfileId);
    const mine = await addGroups(inst.tenantId);
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    await gqlRequest(result.httpServer, {
      query: UPDATE,
      token: tokenFor(inst),
      variables: { id: student.studentProfileId, input: { version, bloodGroup: 'O+' } },
    });
    const [payload] = emitted(emit, EVENT_PATTERNS.STUDENT.updated);
    await groupHandler.onStudentUpdated(payload);

    expect([...(await stateOf(Object.values(mine))).values()]).toEqual([
      'resolved',
      'resolved',
      'resolved',
      'resolved',
    ]);
  });

  it('should emit nothing and keep the status on a refused transition', async () => {
    const inst = await createTestInstitute(result.db);
    const student = await createStudentFixture(result.db, inst.tenantId);
    await gqlRequest(result.httpServer, {
      query: TRANSITION,
      token: tokenFor(inst),
      variables: { id: student.studentProfileId, newStatus: AcademicStatus.PROMOTED },
    });
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    const response = await gqlRequest(result.httpServer, {
      query: TRANSITION,
      token: tokenFor(inst),
      variables: { id: student.studentProfileId, newStatus: AcademicStatus.DETAINED },
    });

    expect(response.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');
    expect(emit).not.toHaveBeenCalled();
    expect((await statusOf(student.studentProfileId)).status).toBe(AcademicStatus.PROMOTED);
  });

  it('should emit STUDENT.statusChanged when updateStudent changes academicStatus', async () => {
    const inst = await createTestInstitute(result.db);
    const student = await createStudentFixture(result.db, inst.tenantId);
    const { version } = await statusOf(student.studentProfileId);
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    const response = await gqlRequest(result.httpServer, {
      query: UPDATE,
      token: tokenFor(inst),
      variables: {
        id: student.studentProfileId,
        input: { version, academicStatus: AcademicStatus.SUSPENDED },
      },
    });

    expect(response.errors).toBeUndefined();
    expect(emitted(emit, EVENT_PATTERNS.STUDENT.statusChanged)).toEqual([
      {
        studentProfileId: student.studentProfileId,
        fromStatus: AcademicStatus.ENROLLED,
        toStatus: AcademicStatus.SUSPENDED,
        reason: null,
        tenantId: inst.tenantId,
      },
    ]);
    expect((await statusOf(student.studentProfileId)).status).toBe(AcademicStatus.SUSPENDED);
  });

  it('should refuse another institute’s student on both mutations and emit nothing', async () => {
    const inst = await createTestInstitute(result.db);
    const theirs = await createStudentFixture(result.db, other.tenantId);
    const before = await statusOf(theirs.studentProfileId);
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    const transition = await gqlRequest(result.httpServer, {
      query: TRANSITION,
      token: tokenFor(inst),
      variables: { id: theirs.studentProfileId, newStatus: AcademicStatus.PROMOTED },
    });
    const update = await gqlRequest(result.httpServer, {
      query: UPDATE,
      token: tokenFor(inst),
      variables: {
        id: theirs.studentProfileId,
        input: { version: before.version, academicStatus: AcademicStatus.PROMOTED },
      },
    });

    expect(transition.errors?.[0]?.extensions?.code).toBe('STUDENT_NOT_FOUND');
    expect(update.errors?.[0]?.extensions?.code).toBe('STUDENT_NOT_FOUND');
    expect(emit).not.toHaveBeenCalled();
    expect(await statusOf(theirs.studentProfileId)).toEqual(before);
  });
});
