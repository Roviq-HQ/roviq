/**
 * ROV-361: the "section reached its optimal strength" warning is decided inside the placement's
 * own transaction, under the section row lock, so concurrent placements warn exactly once and
 * every placement path warns.
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  DefaultRoles,
  Gender,
  SocialCategory,
} from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  instituteConfigs,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  tenantUserProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { createMock } from '@roviq/testing';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import { AppModule } from '../../../app/app.module';
import { IdentityService } from '../../../auth/identity.service';
import { createStudentAdmissionActivities } from '../../admission/workflows/student-admission.activities';
import { createBulkStudentImportActivities } from '../workflows/bulk-student-import.activities';
import type { ImportFileStore } from '../workflows/bulk-student-import.types';

const ORIGIN = 'test:section-capacity-warning';
const OPTIMAL = 3;
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const ENROL = `mutation Enrol($input: EnrollStudentInput!) { enrollStudent(input: $input) }`;
const MOVE = `
  mutation Move($input: UpdateStudentSectionInput!) { updateStudentSection(input: $input) }`;
const CHANGE_CLASS = `
  mutation ChangeClass($input: ChangeStudentClassInput!) { changeStudentClass(input: $input) }`;
const TRANSITION = `
  mutation Transition($id: ID!, $newStatus: AcademicStatus!) {
    transitionStudentStatus(id: $id, newStatus: $newStatus) { id }
  }`;
const UPDATE_STUDENT = `
  mutation Update($id: ID!, $input: UpdateStudentInput!) { updateStudent(id: $id, input: $input) { id } }`;
const CREATE_STUDENT = `
  mutation CreateStudent($input: CreateStudentInput!) { createStudent(input: $input) { id } }`;

describe('section capacity warning at the optimal crossing (ROV-361)', () => {
  let result: IntegrationAppResult;
  let inst: TestInstitute;
  let token: string;
  let yearId: string;
  let standardId: string;
  let otherStandardId: string;
  let emit: MockInstance<EventBusService['emit']>;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  async function addSection(inStandardId = standardId): Promise<string> {
    return asAdmin(async (tx) => {
      const label = randomUUID().slice(0, 6);
      const [section] = await tx
        .insert(sections)
        .values({
          tenantId: inst.tenantId,
          standardId: inStandardId,
          academicYearId: yearId,
          name: { en: label },
          displayLabel: label,
          capacity: 10,
          ...BY,
        })
        .returning({ id: sections.id });
      return section.id;
    });
  }

  /** A student (enrolled unless said otherwise), placed in the section when one is given. */
  async function addStudent(
    sectionId?: string,
    academicStatus: AcademicStatus = AcademicStatus.ENROLLED,
  ): Promise<{ profileId: string; academicId: string | null }> {
    return asAdmin(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.tenantId, inst.tenantId))
        .limit(1);
      const [user] = await tx
        .insert(users)
        .values({
          ...BY,
          email: `capacity_${suffix}@test.local`,
          username: `capacity_${suffix}`,
          passwordHash: 'not-a-real-hash',
        })
        .returning({ id: users.id });
      await tx.insert(tenantUserProfiles).values({
        tenantId: inst.tenantId,
        userId: user.id,
        firstName: { en: `Student ${suffix}` },
        ...BY,
      });
      const [membership] = await tx
        .insert(memberships)
        .values({ tenantId: inst.tenantId, userId: user.id, roleId: role.id, abilities: [], ...BY })
        .returning({ id: memberships.id });
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId: inst.tenantId,
          userId: user.id,
          membershipId: membership.id,
          admissionNumber: `CAP-${suffix}`,
          admissionDate: '2026-04-01',
          admissionType: AdmissionType.NEW,
          academicStatus,
          socialCategory: SocialCategory.GENERAL,
          ...BY,
        })
        .returning({ id: studentProfiles.id });
      if (!sectionId) return { profileId: profile.id, academicId: null };
      const [placed] = await tx
        .select({ standardId: sections.standardId })
        .from(sections)
        .where(eq(sections.id, sectionId));
      const [academic] = await tx
        .insert(studentAcademics)
        .values({
          tenantId: inst.tenantId,
          studentProfileId: profile.id,
          academicYearId: yearId,
          standardId: placed.standardId,
          sectionId,
          ...BY,
        })
        .returning({ id: studentAcademics.id });
      return { profileId: profile.id, academicId: academic.id };
    });
  }

  /** A section already holding `count` enrolled students. */
  async function sectionWith(count: number, inStandardId = standardId): Promise<string> {
    const sectionId = await addSection(inStandardId);
    for (let i = 0; i < count; i++) await addStudent(sectionId);
    return sectionId;
  }

  const strengthOf = (sectionId: string) =>
    asAdmin(async (tx) => {
      const [row] = await tx
        .select({ value: sections.currentStrength })
        .from(sections)
        .where(eq(sections.id, sectionId));
      return row.value;
    });

  /** Payloads of one warning subject sent for the section, from any emitter. */
  const warnings = (calls: unknown[][], pattern: string, sectionId: string) =>
    calls
      .filter(([sent, payload]) => {
        return sent === pattern && (payload as { sectionId: string }).sectionId === sectionId;
      })
      .map(([, payload]) => payload);

  function expectOneWarning(calls: unknown[][], sectionId: string) {
    const expected = {
      tenantId: inst.tenantId,
      sectionId,
      currentStrength: OPTIMAL,
      optimal: OPTIMAL,
    };
    expect(warnings(calls, EVENT_PATTERNS.SECTION.capacity_warning, sectionId)).toEqual([expected]);
    expect(
      warnings(calls, EVENT_PATTERNS.NOTIFICATION.SECTION_CAPACITY_WARNING, sectionId),
    ).toEqual([expected]);
  }

  const enrol = (profileId: string, sectionId: string) =>
    gqlRequest<{ enrollStudent: string }>(result.httpServer, {
      query: ENROL,
      variables: {
        input: { studentProfileId: profileId, academicYearId: yearId, standardId, sectionId },
      },
      token,
    });

  const move = (studentAcademicId: string, newSectionId: string) =>
    gqlRequest<{ updateStudentSection: string }>(result.httpServer, {
      query: MOVE,
      variables: { input: { studentAcademicId, newSectionId } },
      token,
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    inst = await createTestInstitute(result.db);
    token = createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });
    await asAdmin(async (tx) => {
      await tx.insert(roles).values({
        name: { en: DefaultRoles.Student },
        scope: 'institute',
        tenantId: inst.tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        ...BY,
      });
      await tx.insert(instituteConfigs).values({
        tenantId: inst.tenantId,
        sectionStrengthNorms: { optimal: OPTIMAL, hardMax: 10, exemptionAllowed: true },
        ...BY,
      });
      const [year] = await tx
        .insert(academicYears)
        .values({
          tenantId: inst.tenantId,
          label: '2026-27',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
          isActive: true,
          status: 'ACTIVE',
          ...BY,
        })
        .returning({ id: academicYears.id });
      const added = await tx
        .insert(standards)
        .values(
          [5, 6].map((order) => ({
            tenantId: inst.tenantId,
            academicYearId: year.id,
            name: { en: `Class ${order}` },
            numericOrder: order,
            level: 'PRIMARY' as const,
            ...BY,
          })),
        )
        .returning({ id: standards.id });
      yearId = year.id;
      standardId = added[0].id;
      otherStandardId = added[1].id;
    });
  });

  beforeEach(() => {
    emit = vi.spyOn(result.app.get(EventBusService), 'emit');
    emit.mockClear();
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should warn once when two concurrent enrolments take the section from optimal-2 to optimal', async () => {
    const sectionId = await sectionWith(OPTIMAL - 2);
    const [a, b] = [await addStudent(), await addStudent()];

    const responses = await Promise.all([
      enrol(a.profileId, sectionId),
      enrol(b.profileId, sectionId),
    ]);

    expect(responses.map((r) => r.errors)).toEqual([undefined, undefined]);
    expect(await strengthOf(sectionId)).toBe(OPTIMAL);
    expectOneWarning(emit.mock.calls, sectionId);
  });

  it('should warn once when two concurrent enrolments start at optimal-1', async () => {
    const sectionId = await sectionWith(OPTIMAL - 1);
    const [a, b] = [await addStudent(), await addStudent()];

    const responses = await Promise.all([
      enrol(a.profileId, sectionId),
      enrol(b.profileId, sectionId),
    ]);

    expect(responses.map((r) => r.errors)).toEqual([undefined, undefined]);
    expect(await strengthOf(sectionId)).toBe(OPTIMAL + 1);
    expectOneWarning(emit.mock.calls, sectionId);
  });

  it('should warn once when an enrolment and a section change race at optimal-1', async () => {
    const sectionId = await sectionWith(OPTIMAL - 1);
    const otherSectionId = await addSection();
    const mover = await addStudent(otherSectionId);
    const newcomer = await addStudent();

    const responses = await Promise.all([
      move(mover.academicId as string, sectionId),
      enrol(newcomer.profileId, sectionId),
    ]);

    expect(responses.map((r) => r.errors)).toEqual([undefined, undefined]);
    expect(await strengthOf(sectionId)).toBe(OPTIMAL + 1);
    expectOneWarning(emit.mock.calls, sectionId);
  });

  it('should warn once when two concurrent section changes cross the optimal strength', async () => {
    const sectionId = await sectionWith(OPTIMAL - 2);
    const otherSectionId = await addSection();
    const [a, b] = [await addStudent(otherSectionId), await addStudent(otherSectionId)];

    const responses = await Promise.all([
      move(a.academicId as string, sectionId),
      move(b.academicId as string, sectionId),
    ]);

    expect(responses.map((r) => r.errors)).toEqual([undefined, undefined]);
    expect(await strengthOf(sectionId)).toBe(OPTIMAL);
    expectOneWarning(emit.mock.calls, sectionId);
  });

  it('should warn when reinstating a suspended student takes the section to its optimal strength', async () => {
    const sectionId = await sectionWith(OPTIMAL - 1);
    const suspended = await addStudent(sectionId, AcademicStatus.SUSPENDED);
    expect(await strengthOf(sectionId)).toBe(OPTIMAL - 1);

    const res = await gqlRequest<{ transitionStudentStatus: { id: string } }>(result.httpServer, {
      query: TRANSITION,
      variables: { id: suspended.profileId, newStatus: AcademicStatus.ENROLLED },
      token,
    });

    expect(res.errors).toBeUndefined();
    expect(await strengthOf(sectionId)).toBe(OPTIMAL);
    expectOneWarning(emit.mock.calls, sectionId);
  });

  it('should warn when updateStudent re-enrols a student into a section at the crossing', async () => {
    const sectionId = await sectionWith(OPTIMAL - 1);
    const returning = await addStudent(sectionId, AcademicStatus.RE_ENROLLED);
    const [profile] = await asAdmin((tx) =>
      tx
        .select({ version: studentProfiles.version })
        .from(studentProfiles)
        .where(eq(studentProfiles.id, returning.profileId)),
    );

    const res = await gqlRequest<{ updateStudent: { id: string } }>(result.httpServer, {
      query: UPDATE_STUDENT,
      variables: {
        id: returning.profileId,
        input: { academicStatus: AcademicStatus.ENROLLED, version: profile.version },
      },
      token,
    });

    expect(res.errors).toBeUndefined();
    expect(await strengthOf(sectionId)).toBe(OPTIMAL);
    expectOneWarning(emit.mock.calls, sectionId);
  });

  it('should not warn when a status change takes a student out of a full section', async () => {
    const sectionId = await sectionWith(OPTIMAL);
    const leaving = await addStudent(sectionId);

    const res = await gqlRequest<{ transitionStudentStatus: { id: string } }>(result.httpServer, {
      query: TRANSITION,
      variables: { id: leaving.profileId, newStatus: AcademicStatus.SUSPENDED },
      token,
    });

    expect(res.errors).toBeUndefined();
    expect(await strengthOf(sectionId)).toBe(OPTIMAL);
    expect(warnings(emit.mock.calls, EVENT_PATTERNS.SECTION.capacity_warning, sectionId)).toEqual(
      [],
    );
  });

  /** Until some backend waits on another transaction's lock. */
  async function waitForLockWait(): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const waiting = await asAdmin((tx) =>
        tx.execute(
          sql`SELECT count(*) AS n FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'`,
        ),
      );
      if (Number((waiting.rows[0] as { n: string }).n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('The write never waited on the held placement row');
  }

  /** Whether another transaction could lock the section right now. */
  const sectionIsFree = (sectionId: string) =>
    asAdmin(async (tx) => {
      const rows = await tx.execute(
        sql`SELECT id FROM sections WHERE id = ${sectionId} FOR NO KEY UPDATE SKIP LOCKED`,
      );
      return rows.rows.length === 1;
    });

  it.each([
    ['a section change', 'move'],
    ['a class change', 'changeClass'],
  ] as const)('should lock the placement row before the sections in %s', async (_label, write) => {
    const fromId = await addSection(write === 'move' ? standardId : otherStandardId);
    const toId = await addSection(standardId);
    const student = await addStudent(await addSection());
    const academicId = student.academicId as string;
    // Puts the student in `fromId` first, so the write has a section to leave as well.
    await asAdmin((tx) =>
      tx
        .update(studentAcademics)
        .set({
          sectionId: fromId,
          standardId: write === 'move' ? standardId : otherStandardId,
        })
        .where(eq(studentAcademics.id, academicId)),
    );

    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markHeld = () => {};
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    const holder = asAdmin(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM student_academics WHERE id = ${academicId} FOR NO KEY UPDATE`,
      );
      markHeld();
      await released;
    });
    await held;

    const pending =
      write === 'move'
        ? move(academicId, toId)
        : gqlRequest<{ changeStudentClass: string }>(result.httpServer, {
            query: CHANGE_CLASS,
            variables: { input: { studentAcademicId: academicId, standardId, sectionId: toId } },
            token,
          });
    await waitForLockWait();
    const free = [await sectionIsFree(fromId), await sectionIsFree(toId)];
    release();
    await holder;
    const res = await pending;

    expect(free).toEqual([true, true]);
    expect(res.errors).toBeUndefined();
  });

  it('should warn when a class change takes the new section to its optimal strength', async () => {
    const sectionId = await sectionWith(OPTIMAL - 1, otherStandardId);
    const mover = await addStudent(await addSection());

    const res = await gqlRequest<{ changeStudentClass: string }>(result.httpServer, {
      query: CHANGE_CLASS,
      variables: {
        input: {
          studentAcademicId: mover.academicId,
          standardId: otherStandardId,
          sectionId,
        },
      },
      token,
    });

    expect(res.errors).toBeUndefined();
    expect(await strengthOf(sectionId)).toBe(OPTIMAL);
    expectOneWarning(emit.mock.calls, sectionId);
  });

  it('should warn when createStudent places the student at the optimal crossing', async () => {
    const sectionId = await sectionWith(OPTIMAL - 1);

    const res = await gqlRequest<{ createStudent: { id: string } }>(result.httpServer, {
      query: CREATE_STUDENT,
      variables: {
        input: {
          firstName: { en: 'Ira' },
          lastName: { en: 'Sen' },
          academicYearId: yearId,
          standardId,
          sectionId,
        },
      },
      token,
    });

    expect(res.errors).toBeUndefined();
    expect(await strengthOf(sectionId)).toBe(OPTIMAL);
    expectOneWarning(emit.mock.calls, sectionId);
  });

  it('should warn once when a bulk import crosses the optimal strength', async () => {
    const sectionId = await sectionWith(OPTIMAL - 2);
    const nats = { emit: vi.fn(() => ({ subscribe: vi.fn() })) };
    const activities = createBulkStudentImportActivities(
      result.db,
      nats,
      result.app.get(IdentityService),
      createMock<ImportFileStore>(),
    );

    const outcome = await activities.insertBatch(
      inst.tenantId,
      yearId,
      standardId,
      sectionId,
      inst.userId,
      ['Anu', 'Bina', 'Charu'].map((firstName, index) => ({
        rowNumber: index + 1,
        firstName,
        lastName: 'Rao',
        dateOfBirth: '2015-06-01',
        gender: Gender.FEMALE,
      })),
    );

    expect(outcome.errors).toEqual([]);
    expect(outcome.created).toBe(3);
    expect(await strengthOf(sectionId)).toBe(OPTIMAL + 1);
    expectOneWarning(nats.emit.mock.calls, sectionId);
  });

  it('should warn when the admission workflow places the student at the optimal crossing', async () => {
    const sectionId = await sectionWith(OPTIMAL - 1);
    const eventBus = result.app.get(EventBusService);
    const activities = createStudentAdmissionActivities(
      result.db,
      eventBus,
      result.app.get(IdentityService),
    );

    await activities.admitStudent({
      tenantId: inst.tenantId,
      actorId: inst.userId,
      seed: randomUUID(),
      academicYearId: yearId,
      standardId,
      sectionId,
      formData: { studentName: 'Admitted Child' },
      isRte: false,
    });

    expect(await strengthOf(sectionId)).toBe(OPTIMAL);
    expectOneWarning(emit.mock.calls, sectionId);
  });
});
