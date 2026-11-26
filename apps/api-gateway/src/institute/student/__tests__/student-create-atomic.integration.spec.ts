/**
 * ROV-275: a student is admitted in one institute transaction. A failure after the account is
 * made leaves no institute row, no gap in the admission or roll number series, and no account
 * behind.
 */
import assert from 'node:assert/strict';
import {
  AcademicStatus,
  AdmissionType,
  DefaultRoles,
  ErrorCode,
  SocialCategory,
} from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  pgErrorCode,
  phoneNumbers,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  tenantSequences,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { IdentityService } from '../../../auth/identity.service';
import { StudentRepository } from '../repositories/student.repository';

const ORIGIN = 'test:student-create-atomic';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const PHONE = '9876543210';

const NEW_PROFILE = {
  admissionDate: '2026-11-26',
  admissionClass: null,
  admissionType: AdmissionType.NEW,
  academicStatus: AcademicStatus.ENROLLED,
  socialCategory: SocialCategory.GENERAL,
  caste: null,
  isMinority: false,
  minorityType: null,
  isBpl: false,
  isCwsn: false,
  cwsnType: null,
  isRteAdmitted: false,
  rteCertificate: null,
  previousSchoolName: null,
  previousSchoolBoard: null,
  previousSchoolUdise: null,
  incomingTcNumber: null,
  incomingTcDate: null,
};

const CREATE_STUDENT = /* GraphQL */ `
  mutation CreateStudent($input: CreateStudentInput!) {
    createStudent(input: $input) {
      id
      admissionNumber
    }
  }
`;

interface Placement {
  academicYearId: string;
  standardId: string;
  sectionId: string;
}

describe('createStudent: one institute transaction (ROV-275)', () => {
  let result: IntegrationAppResult;
  let inst: TestInstitute;
  let place: Placement;
  let token: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Every row a student create writes, for this institute and the accounts its admin made. */
  const written = () =>
    asAdmin(async (tx) => {
      const made = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.createdBy, inst.userId));
      const ids = made.map((u) => u.id);
      const byUser = <T>(rows: Promise<T[]>) => (ids.length === 0 ? Promise.resolve([]) : rows);
      return {
        users: ids,
        phones: await byUser(
          tx
            .select({ id: phoneNumbers.id })
            .from(phoneNumbers)
            .where(inArray(phoneNumbers.userId, ids)),
        ),
        accountProfiles: await byUser(
          tx
            .select({ id: userProfiles.id })
            .from(userProfiles)
            .where(inArray(userProfiles.userId, ids)),
        ),
        memberships: await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, inst.tenantId),
              sql`${memberships.userId} <> ${inst.userId}`,
            ),
          ),
        copies: await tx
          .select({ id: tenantUserProfiles.id })
          .from(tenantUserProfiles)
          .where(
            and(
              eq(tenantUserProfiles.tenantId, inst.tenantId),
              sql`${tenantUserProfiles.userId} <> ${inst.userId}`,
            ),
          ),
        profiles: await tx
          .select({ id: studentProfiles.id, admissionNumber: studentProfiles.admissionNumber })
          .from(studentProfiles)
          .where(eq(studentProfiles.tenantId, inst.tenantId)),
        academics: await tx
          .select({ id: studentAcademics.id })
          .from(studentAcademics)
          .where(eq(studentAcademics.tenantId, inst.tenantId)),
        counters: await tx
          .select({ name: tenantSequences.sequenceName, value: tenantSequences.currentValue })
          .from(tenantSequences)
          .where(
            and(
              eq(tenantSequences.tenantId, inst.tenantId),
              like(tenantSequences.sequenceName, 'adm_no%'),
            ),
          )
          .orderBy(tenantSequences.sequenceName),
        strength: (
          await tx
            .select({ value: sections.currentStrength })
            .from(sections)
            .where(eq(sections.id, place.sectionId))
        )[0]?.value,
      };
    });

  const create = (firstName: string) =>
    gqlRequest<{ createStudent: { id: string; admissionNumber: string } }>(result.httpServer, {
      query: CREATE_STUDENT,
      variables: {
        input: { firstName: { en: firstName }, lastName: { en: 'Iyer' }, phone: PHONE, ...place },
      },
      token,
    });

  const setSectionDeleted = (deleted: boolean) =>
    asAdmin((tx) =>
      tx
        .update(sections)
        .set({ deletedAt: deleted ? new Date() : null, deletedBy: deleted ? SYSTEM_USER_ID : null })
        .where(eq(sections.id, place.sectionId)),
    );

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    inst = await createTestInstitute(result.db);
    token = createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });
    place = await asAdmin(async (tx) => {
      await tx.insert(roles).values({
        name: { en: DefaultRoles.Student },
        scope: 'institute',
        tenantId: inst.tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
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
      const [standard] = await tx
        .insert(standards)
        .values({
          tenantId: inst.tenantId,
          academicYearId: year.id,
          name: { en: 'Class 5' },
          numericOrder: 5,
          level: 'PRIMARY',
          ...BY,
        })
        .returning({ id: standards.id });
      const [section] = await tx
        .insert(sections)
        .values({
          tenantId: inst.tenantId,
          standardId: standard.id,
          academicYearId: year.id,
          name: { en: 'A' },
          displayLabel: 'Class 5-A',
          capacity: 40,
          ...BY,
        })
        .returning({ id: sections.id });
      return { academicYearId: year.id, standardId: standard.id, sectionId: section.id };
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await result?.close();
  });

  it('should leave nothing behind when the section is deleted between the check and the write', async () => {
    // The first admission creates the series, so the counter has a value to compare.
    const first = await create('Meera');
    expect(first.errors).toBeUndefined();

    const before = await written();
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');
    const repository = result.app.get(StudentRepository);
    const realCheck = repository.checkAdmissionClass.bind(repository);
    const check = vi
      .spyOn(repository, 'checkAdmissionClass')
      .mockImplementationOnce(async (tenantId, data) => {
        const found = await realCheck(tenantId, data);
        await setSectionDeleted(true);
        return found;
      });

    const res = await create('Kabir');

    expect(check).toHaveBeenCalledTimes(1);
    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.SECTION_NOT_FOUND);
    expect(res.data).toBeNull();
    expect(await written()).toEqual(before);
    expect(emit).not.toHaveBeenCalled();

    // Retry once the section is back: one student, the next number in the series, no gap.
    await setSectionDeleted(false);
    const retry = await create('Kabir');
    expect(retry.errors).toBeUndefined();
    assert(retry.data);
    const after = await written();
    expect(after.users).toHaveLength(before.users.length + 1);
    expect(after.profiles).toHaveLength(before.profiles.length + 1);
    expect(after.academics).toHaveLength(before.academics.length + 1);
    expect(after.strength).toBe((before.strength ?? 0) + 1);
    const [counterBefore] = before.counters;
    const [counterAfter] = after.counters;
    expect(counterAfter).toEqual({ ...counterBefore, value: counterBefore.value + 1n });
    expect(emit).toHaveBeenCalledTimes(1);
    emit.mockRestore();
  });

  it('should roll every institute row back when a database error is thrown after the profile insert', async () => {
    const existing = await create('Ishaan');
    expect(existing.errors).toBeUndefined();
    assert(existing.data);
    // The next roll number has 11 digits and does not fit `roll_number` (varchar 10): the
    // enrolment insert fails after the membership, the profile copy, the admission number and
    // the student profile are written.
    const rollSeries = `roll_no:${place.sectionId}:${place.academicYearId}`;
    const setRollCounter = (value: bigint) =>
      asAdmin((tx) =>
        tx
          .insert(tenantSequences)
          .values({ tenantId: inst.tenantId, sequenceName: rollSeries, currentValue: value })
          .onConflictDoUpdate({
            target: [tenantSequences.tenantId, tenantSequences.sequenceName],
            set: { currentValue: value },
          }),
      );
    const rollCounter = async () =>
      (
        await asAdmin((tx) =>
          tx
            .select({ value: tenantSequences.currentValue })
            .from(tenantSequences)
            .where(
              and(
                eq(tenantSequences.tenantId, inst.tenantId),
                eq(tenantSequences.sequenceName, rollSeries),
              ),
            ),
        )
      )[0]?.value;
    await setRollCounter(9_999_999_999n);
    const identity = result.app.get(IdentityService);
    const { userId } = await identity.createUser({
      email: `atomic-${Date.now()}@roviq.test`,
      username: `atomic-${Date.now()}`,
      actorId: inst.userId,
      originTenantId: inst.tenantId,
    });
    const admit = () =>
      result.app.get(StudentRepository).admit({
        tenantId: inst.tenantId,
        userId,
        actorId: inst.userId,
        ...place,
        tenantProfile: { firstName: { en: 'Zoya' }, lastName: null },
        profile: NEW_PROFILE,
        admissionNumber: null,
        assignRollNumber: true,
      });
    const before = await written();

    const failure = await admit().then(
      () => null,
      (error: unknown) => error,
    );

    expect(pgErrorCode(failure)).toBe('22001');
    expect(await written()).toEqual(before);
    expect(await rollCounter()).toBe(9_999_999_999n);

    // With the roll series back in range the same admission succeeds with the very next
    // admission number: the failed attempt used none.
    await setRollCounter(0n);
    const admitted = await admit();
    assert(admitted.kind === 'ok');
    const [counter] = before.counters;
    expect(counter.value).toBe(BigInt(existing.data.createStudent.admissionNumber.slice(-4)));
    expect(admitted.admissionNumber).toBe(String(counter.value + 1n).padStart(4, '0'));
    expect(await rollCounter()).toBe(1n);
    expect((await written()).strength).toBe((before.strength ?? 0) + 1);
  });
});
