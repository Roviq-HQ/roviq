/**
 * ROV-367: admission numbers the institute supplies (bulk import today) and generated numbers
 * never collide. A supplied number that fits its own series raises that series' counter, and
 * generation skips numbers a live student already holds.
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  DefaultRoles,
  ErrorCode,
  Gender,
  SocialCategory,
} from '@roviq/common-types';
import {
  type AdmissionNumberConfig,
  academicYears,
  type DrizzleDB,
  instituteConfigs,
  mkAdminCtx,
  resolveAdmissionYear,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentProfiles,
  tenantSequences,
  withAdmin,
} from '@roviq/database';
import { createMock } from '@roviq/testing';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { IdentityService } from '../../../auth/identity.service';
import { nextAdmissionNumber } from '../admission-number.sequence';
import { StudentRepository } from '../repositories/student.repository';
import { createBulkStudentImportActivities } from '../workflows/bulk-student-import.activities';
import type { ImportFileStore, ValidatedRow } from '../workflows/bulk-student-import.types';

const ORIGIN = 'test:supplied-admission-number';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const CONFIG: AdmissionNumberConfig = {
  format: '{prefix}{year}/{value:04d}',
  year_format: 'YYYY',
  prefixes: { '-3': 'N-' },
  no_prefix_from_class: 2,
};
const YEAR = resolveAdmissionYear(CONFIG, new Date());
const LAST_YEAR = String(Number(YEAR) - 1);
const PLAIN = 'adm_no:';
const NURSERY = 'adm_no:N-';
const serial = (n: number) => `${YEAR}/${String(n).padStart(4, '0')}`;

const CREATE_STUDENT = /* GraphQL */ `
  mutation CreateStudent($input: CreateStudentInput!) {
    createStudent(input: $input) {
      admissionNumber
    }
  }
`;

interface ClassRef {
  standardId: string;
  sectionId: string;
}

describe('Supplied admission numbers (ROV-367, integration)', () => {
  let result: IntegrationAppResult;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const setUpInstitute = async () => {
    const inst = await createTestInstitute(result.db);
    const token = createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });
    const fixture = await asAdmin(async (tx) => {
      await tx.insert(instituteConfigs).values({
        tenantId: inst.tenantId,
        admissionNumberConfig: CONFIG,
        ...BY,
      });
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
      const addClass = async (
        name: string,
        numericOrder: number,
        level: 'PRE_PRIMARY' | 'PRIMARY',
      ): Promise<ClassRef> => {
        const [std] = await tx
          .insert(standards)
          .values({
            tenantId: inst.tenantId,
            academicYearId: year.id,
            name: { en: name },
            numericOrder,
            level,
            ...BY,
          })
          .returning({ id: standards.id });
        const [sec] = await tx
          .insert(sections)
          .values({
            tenantId: inst.tenantId,
            standardId: std.id,
            academicYearId: year.id,
            name: { en: 'A' },
            displayLabel: `${name}-A`,
            capacity: 60,
            ...BY,
          })
          .returning({ id: sections.id });
        return { standardId: std.id, sectionId: sec.id };
      };
      return {
        academicYearId: year.id,
        nursery: await addClass('Nursery', -3, 'PRE_PRIMARY'),
        class5: await addClass('Class 5', 5, 'PRIMARY'),
      };
    });

    const admitByForm = (target: ClassRef) =>
      gqlRequest<{ createStudent: { admissionNumber: string } }>(result.httpServer, {
        query: CREATE_STUDENT,
        token,
        variables: {
          input: {
            firstName: { en: `Student ${randomUUID().slice(0, 6)}` },
            gender: Gender.FEMALE,
            academicYearId: fixture.academicYearId,
            ...target,
          },
        },
      });

    const formNumber = async (target: ClassRef) => {
      const res = await admitByForm(target);
      expect(res.errors).toBeUndefined();
      const number = res.data?.createStudent.admissionNumber;
      if (!number) throw new Error('createStudent returned no admission number');
      return number;
    };

    const importNumbers = async (numbers: string[], target: ClassRef = fixture.class5) => {
      const activities = createBulkStudentImportActivities(
        result.db,
        null,
        result.app.get(IdentityService),
        createMock<ImportFileStore>(),
      );
      const rows: ValidatedRow[] = numbers.map((admissionNumber, i) => ({
        rowNumber: i + 1,
        firstName: `Imported ${i + 1}`,
        dateOfBirth: '2015-06-01',
        gender: Gender.FEMALE,
        admissionNumber,
        standardId: target.standardId,
        sectionId: target.sectionId,
      }));
      return activities.insertBatch(
        inst.tenantId,
        fixture.academicYearId,
        target.standardId,
        target.sectionId,
        inst.userId,
        rows,
      );
    };

    const counters = () =>
      asAdmin(async (tx) => {
        const rows = await tx
          .select({ name: tenantSequences.sequenceName, value: tenantSequences.currentValue })
          .from(tenantSequences)
          .where(eq(tenantSequences.tenantId, inst.tenantId));
        // Roll-number series move too; only the admission series matter here.
        return Object.fromEntries(
          rows.filter((r) => r.name.startsWith('adm_no')).map((r) => [r.name, r.value]),
        );
      });

    const storedNumbers = () =>
      asAdmin(async (tx) =>
        (
          await tx
            .select({ number: studentProfiles.admissionNumber })
            .from(studentProfiles)
            .where(eq(studentProfiles.tenantId, inst.tenantId))
        )
          .map((r) => r.number)
          .sort(),
      );

    const setCounter = (sequenceName: string, value: bigint) =>
      asAdmin((tx) =>
        tx
          .update(tenantSequences)
          .set({ currentValue: value })
          .where(
            and(
              eq(tenantSequences.tenantId, inst.tenantId),
              eq(tenantSequences.sequenceName, sequenceName),
            ),
          ),
      );

    return {
      inst,
      fixture,
      admitByForm,
      formNumber,
      importNumbers,
      counters,
      storedNumbers,
      setCounter,
    };
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should continue the series after imported numbers that fit it', async () => {
    const { fixture, importNumbers, counters, formNumber } = await setUpInstitute();

    const outcome = await importNumbers([serial(1), serial(2), serial(3)]);
    expect(outcome.created).toBe(3);
    expect(await counters()).toEqual({ [PLAIN]: 3n });

    expect(await formNumber(fixture.class5)).toBe(serial(4));
    expect(await counters()).toEqual({ [PLAIN]: 4n });
  });

  it('should give the next number after an imported register of ten', async () => {
    const { fixture, importNumbers, formNumber } = await setUpInstitute();

    const outcome = await importNumbers(Array.from({ length: 10 }, (_, i) => serial(i + 1)));
    expect(outcome.created).toBe(10);

    expect(await formNumber(fixture.class5)).toBe(serial(11));
  });

  it('should store a number of another shape and leave every counter alone', async () => {
    const { fixture, importNumbers, counters, storedNumbers, formNumber } = await setUpInstitute();

    const outcome = await importNumbers(['OLD-17']);
    expect(outcome.created).toBe(1);
    expect(await storedNumbers()).toEqual(['OLD-17']);
    expect(await counters()).toEqual({});

    expect(await formNumber(fixture.class5)).toBe(serial(1));
  });

  it('should skip a taken number the counter does not know about', async () => {
    const { fixture, importNumbers, setCounter, counters, formNumber } = await setUpInstitute();
    // A register imported before ROV-367: the number is stored, the counter never moved past it.
    await importNumbers([serial(5)]);
    await setCounter(PLAIN, 4n);

    expect(await formNumber(fixture.class5)).toBe(serial(6));
    expect(await counters()).toEqual({ [PLAIN]: 6n });
  });

  it('should never lower the counter for a lower supplied number', async () => {
    const { importNumbers, counters } = await setUpInstitute();

    await importNumbers([serial(9), serial(2)]);

    expect(await counters()).toEqual({ [PLAIN]: 9n });
  });

  it("should leave counters alone for another year's or another prefix's number", async () => {
    const { fixture, importNumbers, counters, formNumber } = await setUpInstitute();

    const outcome = await importNumbers([`${LAST_YEAR}/0050`, `N-${YEAR}/0050`, `${YEAR}/42`]);
    expect(outcome.created).toBe(3);
    expect(await counters()).toEqual({});

    expect(await formNumber(fixture.nursery)).toBe(`N-${YEAR}/0001`);
    expect(await formNumber(fixture.class5)).toBe(serial(1));
    expect(await counters()).toEqual({ [NURSERY]: 1n, [PLAIN]: 1n });
  });

  it("should not touch another institute's counters", async () => {
    const a = await setUpInstitute();
    const b = await setUpInstitute();
    await b.formNumber(b.fixture.class5);
    const before = await b.counters();

    await a.importNumbers([serial(7)]);

    expect(await a.counters()).toEqual({ [PLAIN]: 7n });
    expect(await b.counters()).toEqual(before);
    expect(before).toEqual({ [PLAIN]: 1n });
  });

  it('should keep numbers unique and the counter at the highest number under concurrency', async () => {
    const { fixture, importNumbers, counters, storedNumbers, formNumber } = await setUpInstitute();

    await Promise.all([
      ...Array.from({ length: 10 }, () => formNumber(fixture.class5)),
      importNumbers([serial(3), serial(7), serial(14)]),
    ]);

    const stored = await storedNumbers();
    expect(new Set(stored).size).toBe(stored.length);
    const highest = stored.reduce((max, n) => Math.max(max, Number(n.split('/')[1])), 0);
    expect(highest).toBeGreaterThanOrEqual(14);
    expect(await counters()).toEqual({ [PLAIN]: BigInt(highest) });
  });

  it('should refuse with ADMISSION_NUMBER_SERIES_EXHAUSTED when every number tried is taken', async () => {
    const { inst, fixture, importNumbers, setCounter, counters } = await setUpInstitute();
    await importNumbers([serial(1), serial(2)]);
    await setCounter(PLAIN, 0n);

    await expect(
      asAdmin((tx) =>
        nextAdmissionNumber(tx, inst.tenantId, fixture.class5.standardId, { maxSkips: 1 }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ADMISSION_NUMBER_SERIES_EXHAUSTED });
    expect(await counters()).toEqual({ [PLAIN]: 0n });
  });

  it('should answer ADMISSION_NUMBER_TAKEN, not an internal error, when the number is taken at insert', async () => {
    const { inst, fixture, importNumbers, storedNumbers } = await setUpInstitute();
    await importNumbers([serial(1)]);
    const identity = result.app.get(IdentityService);
    const { userId } = await identity.createUser({
      email: `taken-${randomUUID()}@roviq.test`,
      username: `taken-${randomUUID().slice(0, 12)}`,
      actorId: inst.userId,
    });

    await expect(
      result.app.get(StudentRepository).admit({
        tenantId: inst.tenantId,
        userId,
        actorId: inst.userId,
        academicYearId: fixture.academicYearId,
        standardId: fixture.class5.standardId,
        sectionId: fixture.class5.sectionId,
        tenantProfile: { firstName: { en: 'Clash' }, lastName: null, gender: Gender.FEMALE },
        profile: {
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
        },
        admissionNumber: serial(1),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.ADMISSION_NUMBER_TAKEN });
    expect(await storedNumbers()).toEqual([serial(1)]);
    await identity.discardNewUser(userId);
  });
});
