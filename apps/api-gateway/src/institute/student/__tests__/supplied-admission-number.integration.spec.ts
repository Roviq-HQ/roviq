/**
 * ROV-367: admission numbers the institute supplies (bulk import today) and generated numbers
 * never collide. A supplied number that fits its own series raises that series' counter, and
 * generation moves past numbers a live student already holds.
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
  MAX_SEQUENCE_VALUE,
  mkAdminCtx,
  mkInstituteCtx,
  resolveAdmissionYear,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentProfiles,
  tenantSequences,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { createMock } from '@roviq/testing';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { IdentityService } from '../../../auth/identity.service';
import { nextAdmissionNumber } from '../admission-number.sequence';
import { type AdmitStudentData, admitStudent } from '../repositories/admit-student';
import { StudentRepository } from '../repositories/student.repository';
import {
  createBulkStudentImportActivities,
  ROW_ADMISSION_NUMBERS_EXHAUSTED,
} from '../workflows/bulk-student-import.activities';
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

  /** Resolves once another backend waits on a row lock: an insert held by the unique index. */
  const someoneWaitsOnALock = async () => {
    for (let i = 0; i < 100; i++) {
      const waiting = await asAdmin((tx) =>
        tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'`,
        ),
      );
      if ((waiting.rows[0]?.n ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('No insert ever waited on the held admission');
  };

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

    const importRows = async (numbers: Array<string | undefined>, target = fixture.class5) => {
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
          .insert(tenantSequences)
          .values({ tenantId: inst.tenantId, sequenceName, currentValue: value })
          .onConflictDoUpdate({
            target: [tenantSequences.tenantId, tenantSequences.sequenceName],
            set: { currentValue: value },
          }),
      );

    const newAccount = async () => {
      const { userId } = await result.app.get(IdentityService).createUser({
        email: `adm-${randomUUID()}@roviq.test`,
        username: `adm-${randomUUID().slice(0, 12)}`,
        actorId: inst.userId,
      });
      return userId;
    };

    const admitData = (
      userId: string,
      target: ClassRef,
      admissionNumber: string | null,
    ): AdmitStudentData => ({
      tenantId: inst.tenantId,
      userId,
      actorId: inst.userId,
      academicYearId: fixture.academicYearId,
      standardId: target.standardId,
      sectionId: target.sectionId,
      tenantProfile: { firstName: { en: 'Held' }, lastName: null, gender: Gender.FEMALE },
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
      admissionNumber,
    });

    /** An admission of `number` saved but not committed until `release()`. */
    const holdAdmission = async (number: string, target: ClassRef) => {
      const userId = await newAccount();
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let saved = () => {};
      const ready = new Promise<void>((resolve) => {
        saved = resolve;
      });
      const done = withTenant(result.db, mkInstituteCtx(inst.tenantId, ORIGIN), async (tx) => {
        const admitted = await admitStudent(tx, admitData(userId, target, number));
        saved();
        await released;
        return admitted;
      });
      await ready;
      return { release, done };
    };

    return {
      inst,
      fixture,
      admitByForm,
      formNumber,
      importRows,
      counters,
      storedNumbers,
      setCounter,
      newAccount,
      admitData,
      holdAdmission,
    };
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should continue the series after imported numbers that fit it', async () => {
    const { fixture, importRows, counters, formNumber } = await setUpInstitute();

    const outcome = await importRows([serial(1), serial(2), serial(3)]);
    expect(outcome.created).toBe(3);
    expect(await counters()).toEqual({ [PLAIN]: 3n });

    expect(await formNumber(fixture.class5)).toBe(serial(4));
    expect(await counters()).toEqual({ [PLAIN]: 4n });
  });

  it('should give the next number after an imported register of ten', async () => {
    const { fixture, importRows, formNumber } = await setUpInstitute();

    const outcome = await importRows(Array.from({ length: 10 }, (_, i) => serial(i + 1)));
    expect(outcome.created).toBe(10);

    expect(await formNumber(fixture.class5)).toBe(serial(11));
  });

  it('should raise past the legacy counter only when the supplied number is higher', async () => {
    const { fixture, importRows, setCounter, counters, formNumber } = await setUpInstitute();
    await setCounter('adm_no', 7n);

    await importRows([serial(3)]);
    expect(await counters()).toEqual({ adm_no: 7n, [PLAIN]: 7n });
    expect(await formNumber(fixture.class5)).toBe(serial(8));

    await importRows([serial(12)]);
    expect(await counters()).toEqual({ adm_no: 7n, [PLAIN]: 12n });
    expect(await formNumber(fixture.class5)).toBe(serial(13));
  });

  it('should store a number of another shape and leave every counter alone', async () => {
    const { fixture, importRows, counters, storedNumbers, formNumber } = await setUpInstitute();

    const outcome = await importRows(['OLD-17']);
    expect(outcome.created).toBe(1);
    expect(await storedNumbers()).toEqual(['OLD-17']);
    expect(await counters()).toEqual({});

    expect(await formNumber(fixture.class5)).toBe(serial(1));
  });

  it('should not let a far-out supplied number wall the series', async () => {
    const { fixture, importRows, counters, formNumber } = await setUpInstitute();

    const outcome = await importRows([`${YEAR}/${MAX_SEQUENCE_VALUE}`, `${YEAR}/1000000`]);
    expect(outcome.created).toBe(2);
    expect(await counters()).toEqual({});

    expect(await formNumber(fixture.class5)).toBe(serial(1));
  });

  it('should cross a block of taken numbers in one step', async () => {
    const { fixture, importRows, setCounter, counters, formNumber } = await setUpInstitute();
    // A register imported before ROV-367: the numbers are stored, the counter never moved.
    await importRows([serial(1), serial(2), serial(3), serial(40)]);
    await setCounter(PLAIN, 0n);

    expect(await formNumber(fixture.class5)).toBe(serial(41));
    expect(await counters()).toEqual({ [PLAIN]: 41n });
  });

  it('should never lower the counter for a lower supplied number', async () => {
    const { importRows, counters } = await setUpInstitute();

    await importRows([serial(9), serial(2)]);

    expect(await counters()).toEqual({ [PLAIN]: 9n });
  });

  it("should leave counters alone for another year's or another prefix's number", async () => {
    const { fixture, importRows, counters, formNumber } = await setUpInstitute();

    const outcome = await importRows([`${LAST_YEAR}/0050`, `N-${YEAR}/0050`, `${YEAR}/42`]);
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

    await a.importRows([serial(7)]);

    expect(await a.counters()).toEqual({ [PLAIN]: 7n });
    expect(await b.counters()).toEqual(before);
    expect(before).toEqual({ [PLAIN]: 1n });
  });

  it('should keep numbers unique and the counter at the highest number under concurrency', async () => {
    const { fixture, importRows, counters, storedNumbers, formNumber } = await setUpInstitute();

    const [imported] = await Promise.all([
      importRows([serial(3), serial(7), serial(14)]),
      ...Array.from({ length: 10 }, () => formNumber(fixture.class5)),
    ]);

    expect(imported.errors).toEqual([]);
    expect(imported.created + imported.skipped).toBe(3);
    const stored = await storedNumbers();
    expect(stored).toHaveLength(10 + imported.created);
    expect(new Set(stored).size).toBe(stored.length);
    const highest = stored.reduce((max, n) => Math.max(max, Number(n.split('/')[1])), 0);
    expect(await counters()).toEqual({ [PLAIN]: BigInt(highest) });
  });

  it('should give the next free number when a generated number is saved by another admission at the same moment', async () => {
    const { fixture, holdAdmission, formNumber, storedNumbers } = await setUpInstitute();
    // A Nursery student carrying the number Class 5 will generate next: it fits no counter.
    const held = await holdAdmission(serial(1), fixture.nursery);

    const generated = formNumber(fixture.class5);
    await someoneWaitsOnALock();
    held.release();
    expect((await held.done).kind).toBe('ok');

    expect(await generated).toBe(serial(2));
    expect(await storedNumbers()).toEqual([serial(1), serial(2)]);
  });

  it('should report an imported row as skipped when its number is saved at the same moment', async () => {
    const { holdAdmission, fixture, importRows, storedNumbers } = await setUpInstitute();
    const held = await holdAdmission(serial(5), fixture.nursery);

    const imported = importRows([serial(5)]);
    await someoneWaitsOnALock();
    held.release();
    await held.done;

    expect(await imported).toEqual({ created: 0, skipped: 1, errors: [] });
    expect(await storedNumbers()).toEqual([serial(5)]);
  });

  it('should answer ADMISSION_NUMBER_TAKEN for a supplied number taken at insert', async () => {
    const { importRows, storedNumbers, newAccount, admitData, fixture } = await setUpInstitute();
    await importRows([serial(1)]);
    const userId = await newAccount();

    await expect(
      result.app.get(StudentRepository).admit(admitData(userId, fixture.class5, serial(1))),
    ).rejects.toMatchObject({ code: ErrorCode.ADMISSION_NUMBER_TAKEN });
    expect(await storedNumbers()).toEqual([serial(1)]);
    await result.app.get(IdentityService).discardNewUser(userId);
  });

  it('should generate a number for an empty supplied number', async () => {
    const { newAccount, admitData, fixture } = await setUpInstitute();

    const admitted = await result.app
      .get(StudentRepository)
      .admit(admitData(await newAccount(), fixture.class5, ''));

    expect(admitted).toMatchObject({ kind: 'ok', admissionNumber: serial(1) });
  });

  it('should refuse with ADMISSION_NUMBER_SERIES_EXHAUSTED after the last try', async () => {
    const { inst, fixture, importRows, setCounter, counters } = await setUpInstitute();
    await importRows([serial(1), serial(2)]);
    await setCounter(PLAIN, 0n);

    await expect(
      asAdmin((tx) =>
        nextAdmissionNumber(tx, inst.tenantId, fixture.class5.standardId, { maxTries: 1 }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ADMISSION_NUMBER_SERIES_EXHAUSTED });
    expect(await counters()).toEqual({ [PLAIN]: 0n });
  });

  it('should refuse with ADMISSION_NUMBER_SERIES_EXHAUSTED when the counter is at its limit', async () => {
    const { fixture, admitByForm, importRows, setCounter, counters, storedNumbers } =
      await setUpInstitute();
    await setCounter(PLAIN, MAX_SEQUENCE_VALUE);

    const res = await admitByForm(fixture.class5);
    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.ADMISSION_NUMBER_SERIES_EXHAUSTED);

    const outcome = await importRows([undefined]);
    expect(outcome).toEqual({
      created: 0,
      skipped: 0,
      errors: [
        { rowNumber: 1, field: 'admission_number', reason: ROW_ADMISSION_NUMBERS_EXHAUSTED },
      ],
    });
    expect(await storedNumbers()).toEqual([]);
    expect(await counters()).toEqual({ [PLAIN]: MAX_SEQUENCE_VALUE });
  });
});
