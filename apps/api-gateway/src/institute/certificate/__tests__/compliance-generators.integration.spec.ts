/**
 * The six board/government generators (UDISE+ DCF, CBSE registration, CBSE LOC, RTE, TC
 * register, admission register) against real PostgreSQL, run as the institute: names not
 * ids, the class filter, the academic-year filter, APAAR/PEN/registration numbers present,
 * Aadhaar never, and nobody from another institute.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  academicYears,
  createDrizzleDb,
  type DrizzleDB,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  phoneNumbers,
  roles,
  SYSTEM_USER_ID,
  sections,
  staffProfiles,
  standards,
  studentAcademics,
  studentGuardianLinks,
  studentProfiles,
  tcRegister,
  userIdentifiers,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  createTestInstitute,
  type TestInstitute,
} from '@roviq/testing/integration';
import { inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { generateAwrExport } from '../exports/awr.export';
import { generateCbseLocExport } from '../exports/cbse-loc.export';
import { generateCbseRegistrationExport } from '../exports/cbse-registration.export';
import { generateRteReport } from '../exports/rte-report.export';
import { generateTcRegisterExport } from '../exports/tc-register.export';
import type { ComplianceExportOutput } from '../exports/types';
import { generateUdiseDcfExport } from '../exports/udise-dcf.export';

const hasTestDb = !!process.env.DATABASE_URL_TEST;
const ORIGIN = 'test:compliance-generators';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const AADHAAR_MASKED = 'XXXX-XXXX-9876';

function rowsOf(output: ComplianceExportOutput, sheet: string): Record<string, unknown>[] {
  const ws = XLSX.read(output.buffer).Sheets[sheet];
  if (!ws) throw new Error(`Sheet ${sheet} missing`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

function allCells(output: ComplianceExportOutput): string[] {
  const book = XLSX.read(output.buffer);
  return book.SheetNames.flatMap((name) => {
    const ws = book.Sheets[name];
    if (!ws) return [];
    return XLSX.utils
      .sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
      .flat()
      .map((cell) => String(cell));
  });
}

describe.skipIf(!hasTestDb)('Compliance export generators (integration)', () => {
  let pool: Pool;
  let db: DrizzleDB;
  let instA: TestInstitute;
  let instB: TestInstitute;
  const run = randomUUID().slice(0, 6);
  const name = (who: string) => `${who}${run}`;
  const userIds: string[] = [];
  let yearId: string;
  const ids: Record<string, string> = {};

  async function person(
    tx: DrizzleDB,
    tenantId: string,
    roleId: string,
    first: string,
    profile: { gender?: 'MALE' | 'FEMALE'; dateOfBirth?: string } = {},
  ) {
    const handle = `gen_${first.toLowerCase()}_${randomUUID().slice(0, 6)}`;
    const [user] = await tx
      .insert(users)
      .values({ email: `${handle}@test.local`, username: handle, passwordHash: 'x', ...BY })
      .returning({ id: users.id });
    assert(user);
    userIds.push(user.id);
    await tx.insert(userProfiles).values({
      userId: user.id,
      firstName: { en: first },
      lastName: { en: 'Verma' },
      ...profile,
      ...BY,
    });
    const [membership] = await tx
      .insert(memberships)
      .values({ userId: user.id, roleId, tenantId, abilities: [], ...BY })
      .returning({ id: memberships.id });
    assert(membership);
    return { userId: user.id, membershipId: membership.id };
  }

  async function standardWithSection(
    tx: DrizzleDB,
    tenantId: string,
    academicYearId: string,
    label: string,
    udiseClassCode: number,
  ) {
    const [std] = await tx
      .insert(standards)
      .values({
        tenantId,
        academicYearId,
        name: { en: label },
        numericOrder: udiseClassCode,
        udiseClassCode,
        ...BY,
      })
      .returning({ id: standards.id });
    assert(std);
    const [sec] = await tx
      .insert(sections)
      .values({ tenantId, standardId: std.id, academicYearId, name: { en: 'A' }, ...BY })
      .returning({ id: sections.id });
    assert(sec);
    return { standardId: std.id, sectionId: sec.id };
  }

  async function student(
    tx: DrizzleDB,
    tenantId: string,
    roleId: string,
    first: string,
    admissionDate: string,
    placement: { academicYearId: string; standardId: string; sectionId: string },
  ) {
    const p = await person(tx, tenantId, roleId, first, {
      gender: 'FEMALE',
      dateOfBirth: '2011-02-03',
    });
    const [sp] = await tx
      .insert(studentProfiles)
      .values({
        tenantId,
        userId: p.userId,
        membershipId: p.membershipId,
        admissionNumber: `ADM-${first}`,
        admissionDate,
        ...BY,
      })
      .returning({ id: studentProfiles.id });
    assert(sp);
    await tx
      .insert(studentAcademics)
      .values({ tenantId, studentProfileId: sp.id, ...placement, ...BY });
    return { ...p, studentProfileId: sp.id };
  }

  beforeAll(async () => {
    assert(process.env.DATABASE_URL_TEST);
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 5 });
    db = createDrizzleDb(pool);
    instA = await createTestInstitute(db, { slugSuffix: `${run}a` });
    instB = await createTestInstitute(db, { slugSuffix: `${run}b` });

    await withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
      const [roleA] = await tx
        .insert(roles)
        .values({
          name: { en: 'People' },
          scope: 'institute',
          tenantId: instA.tenantId,
          abilities: [],
          isDefault: false,
          isSystem: false,
          ...BY,
        })
        .returning({ id: roles.id });
      const [roleB] = await tx
        .insert(roles)
        .values({
          name: { en: 'People' },
          scope: 'institute',
          tenantId: instB.tenantId,
          abilities: [],
          isDefault: false,
          isSystem: false,
          ...BY,
        })
        .returning({ id: roles.id });
      assert(roleA && roleB);

      const [year, previousYear, yearB] = await tx
        .insert(academicYears)
        .values([
          {
            tenantId: instA.tenantId,
            label: '2025-26',
            startDate: '2025-04-01',
            endDate: '2026-03-31',
            ...BY,
          },
          {
            tenantId: instA.tenantId,
            label: '2024-25',
            startDate: '2024-04-01',
            endDate: '2025-03-31',
            ...BY,
          },
          {
            tenantId: instB.tenantId,
            label: '2025-26',
            startDate: '2025-04-01',
            endDate: '2026-03-31',
            ...BY,
          },
        ])
        .returning({ id: academicYears.id });
      assert(year && previousYear && yearB);
      yearId = year.id;

      const c5 = await standardWithSection(tx, instA.tenantId, year.id, 'Class 5', 5);
      const c9 = await standardWithSection(tx, instA.tenantId, year.id, 'Class 9', 9);
      const c10 = await standardWithSection(tx, instA.tenantId, year.id, 'Class 10', 10);
      const c8old = await standardWithSection(tx, instA.tenantId, previousYear.id, 'Class 8', 8);
      const c9b = await standardWithSection(tx, instB.tenantId, yearB.id, 'Class 9', 9);

      const s9 = await student(tx, instA.tenantId, roleA.id, name('Nine'), '2025-05-10', {
        academicYearId: year.id,
        ...c9,
      });
      const s10 = await student(tx, instA.tenantId, roleA.id, name('Ten'), '2023-04-01', {
        academicYearId: year.id,
        ...c10,
      });
      await student(tx, instA.tenantId, roleA.id, name('Five'), '2025-06-01', {
        academicYearId: year.id,
        ...c5,
      });
      await student(tx, instA.tenantId, roleA.id, name('Gone'), '2022-04-01', {
        academicYearId: previousYear.id,
        ...c8old,
      });
      await student(tx, instB.tenantId, roleB.id, name('Other'), '2025-05-10', {
        academicYearId: yearB.id,
        ...c9b,
      });
      ids.s9User = s9.userId;

      const father = await person(tx, instA.tenantId, roleA.id, name('Father'));
      const [gp] = await tx
        .insert(guardianProfiles)
        .values({
          tenantId: instA.tenantId,
          userId: father.userId,
          membershipId: father.membershipId,
          ...BY,
        })
        .returning({ id: guardianProfiles.id });
      assert(gp);
      await tx.insert(studentGuardianLinks).values({
        tenantId: instA.tenantId,
        studentProfileId: s9.studentProfileId,
        guardianProfileId: gp.id,
        relationship: 'FATHER',
        ...BY,
      });
      ids.fatherPhone = `9${Date.now().toString().slice(-9)}`;
      await tx.insert(phoneNumbers).values({
        userId: father.userId,
        countryCode: '+91',
        number: ids.fatherPhone,
        isPrimary: true,
        ...BY,
      });

      await tx.insert(userIdentifiers).values([
        { userId: s9.userId, type: 'APAAR', valuePlain: `APAAR${run}9`, ...BY },
        { userId: s9.userId, type: 'PEN', valuePlain: `PEN${run}9`, ...BY },
        {
          userId: s9.userId,
          type: 'AADHAAR',
          valueEncrypted: Buffer.from('not-real-ciphertext'),
          valueHash: 'f'.repeat(64),
          valueMasked: AADHAAR_MASKED,
          ...BY,
        },
        { userId: s10.userId, type: 'APAAR', valuePlain: `APAAR${run}10`, ...BY },
        { userId: s10.userId, type: 'CBSE_REGISTRATION', valuePlain: 'A119/03001/0057', ...BY },
      ]);

      await tx.insert(tcRegister).values({
        tenantId: instA.tenantId,
        studentProfileId: s10.studentProfileId,
        academicYearId: year.id,
        tcSerialNumber: `TC-${run}`,
        status: 'ISSUED',
        reason: 'Relocation',
        requestedBy: SYSTEM_USER_ID,
        requestedAt: new Date('2025-11-03T05:00:00Z'),
        issuedAt: new Date('2025-11-05T20:00:00Z'),
        ...BY,
      });

      const teacher = await person(tx, instA.tenantId, roleA.id, name('Teacher'), {
        gender: 'MALE',
        dateOfBirth: '1984-07-09',
      });
      await tx.insert(staffProfiles).values({
        tenantId: instA.tenantId,
        userId: teacher.userId,
        membershipId: teacher.membershipId,
        employeeId: `EMP-${run}`,
        dateOfJoining: '2020-06-01',
        employmentType: 'REGULAR',
        ...BY,
      });
    });
  });

  afterAll(async () => {
    if (!db) return;
    const tenantIds = [instA?.tenantId, instB?.tenantId].filter(
      (id): id is string => typeof id === 'string',
    );
    await withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
      await tx.delete(tcRegister).where(inArray(tcRegister.tenantId, tenantIds));
      await tx
        .delete(studentGuardianLinks)
        .where(inArray(studentGuardianLinks.tenantId, tenantIds));
      await tx.delete(guardianProfiles).where(inArray(guardianProfiles.tenantId, tenantIds));
      await tx.delete(studentAcademics).where(inArray(studentAcademics.tenantId, tenantIds));
      await tx.delete(studentProfiles).where(inArray(studentProfiles.tenantId, tenantIds));
      await tx.delete(staffProfiles).where(inArray(staffProfiles.tenantId, tenantIds));
      if (userIds.length > 0) {
        await tx.delete(userIdentifiers).where(inArray(userIdentifiers.userId, userIds));
        await tx.delete(phoneNumbers).where(inArray(phoneNumbers.userId, userIds));
        await tx.delete(userProfiles).where(inArray(userProfiles.userId, userIds));
      }
      await tx.delete(sections).where(inArray(sections.tenantId, tenantIds));
      await tx.delete(standards).where(inArray(standards.tenantId, tenantIds));
      await tx.delete(academicYears).where(inArray(academicYears.tenantId, tenantIds));
      await tx.delete(memberships).where(inArray(memberships.tenantId, tenantIds));
      if (userIds.length > 0) await tx.delete(users).where(inArray(users.id, userIds));
    });
    if (instA) await cleanupTestInstitute(db, instA);
    if (instB) await cleanupTestInstitute(db, instB);
    await pool?.end();
  });

  function expectNoLeak(output: ComplianceExportOutput) {
    const cells = allCells(output);
    expect(cells.some((cell) => UUID.test(cell))).toBe(false);
    expect(cells.some((cell) => cell.toUpperCase().includes(name('Other').toUpperCase()))).toBe(
      false,
    );
    expect(cells).not.toContain(AADHAAR_MASKED);
  }

  it('UDISE+ DCF: students enrolled in the year by name, with APAAR/PEN, no Aadhaar', async () => {
    const output = await generateUdiseDcfExport(db, instA.tenantId, yearId);

    const students = rowsOf(output, 'Students');
    expect(students.map((r) => r['Student Name'])).toEqual([
      `${name('Five')} Verma`.toUpperCase(),
      `${name('Nine')} Verma`.toUpperCase(),
      `${name('Ten')} Verma`.toUpperCase(),
    ]);
    const nine = students[1];
    assert(nine);
    expect(nine).toMatchObject({
      "Father's Name": `${name('Father')} Verma`,
      'Date of Birth': '03/02/2011',
      Gender: 'Female',
      Class: 'Class 9',
      Section: 'A',
      'APAAR ID': `APAAR${run}9`,
      PEN: `PEN${run}9`,
      'Aadhaar Number': '',
      'Minority Status': 'Not Applicable',
    });
    expect(rowsOf(output, 'Teachers').map((r) => r['Teacher Name'])).toEqual([
      `${name('Teacher')} Verma`.toUpperCase(),
    ]);
    expect(output.rowCount).toBe(4);
    expectNoLeak(output);
  });

  it('CBSE registration: only Class IX and XI of the year, with APAAR and a parent mobile', async () => {
    const output = await generateCbseRegistrationExport(db, instA.tenantId, yearId);

    expect(XLSX.read(output.buffer).SheetNames).toEqual(['Class IX', 'Class XI']);
    const ix = rowsOf(output, 'Class IX');
    expect(ix).toHaveLength(1);
    expect(ix[0]).toMatchObject({
      'Student Name (CAPITALS)': `${name('Nine')} Verma`.toUpperCase(),
      "Father's/Guardian's Name": `${name('Father')} Verma`,
      'Date of Birth': '03/02/2011',
      Gender: 'Female',
      'APAAR ID': `APAAR${run}9`,
      'Mobile Number': ids.fatherPhone,
    });
    expect(rowsOf(output, 'Class XI')).toEqual([]);
    expect(output.rowCount).toBe(1);
    expectNoLeak(output);
  });

  it('CBSE LOC: only Class X and XII, with the CBSE registration number', async () => {
    const output = await generateCbseLocExport(db, instA.tenantId, yearId);

    expect(XLSX.read(output.buffer).SheetNames).toEqual(['Class X', 'Class XII']);
    expect(rowsOf(output, 'Class X')).toEqual([
      {
        'Registration Number': 'A119/03001/0057',
        'Student Name (CAPITALS)': `${name('Ten')} Verma`.toUpperCase(),
        'Date of Birth': '03/02/2011',
        Gender: 'Female',
        'APAAR ID': `APAAR${run}10`,
        'Subject Code 1': '',
        'Subject Code 2': '',
        'Subject Code 3': '',
        'Subject Code 4': '',
        'Subject Code 5': '',
        'Subject Code 6': '',
        'CWSN Status': '',
      },
    ]);
    expect(rowsOf(output, 'Class XII')).toEqual([]);
    expect(output.rowCount).toBe(1);
    expectNoLeak(output);
  });

  it('RTE report: one row per class of the year, by class name', async () => {
    const output = await generateRteReport(db, instA.tenantId, yearId);

    expect(rowsOf(output, 'RTE Report')).toEqual([
      { Class: 'Class 5', 'RTE Students Count': 0, 'Total Students': 1 },
      { Class: 'Class 9', 'RTE Students Count': 0, 'Total Students': 1 },
      { Class: 'Class 10', 'RTE Students Count': 0, 'Total Students': 1 },
    ]);
    expect(output.rowCount).toBe(3);
    expectNoLeak(output);
  });

  it('TC register: the student by name, dates as DD/MM/YYYY in India time', async () => {
    const output = await generateTcRegisterExport(db, instA.tenantId, yearId);

    expect(rowsOf(output, 'TC Register')).toEqual([
      {
        'TC Serial Number': `TC-${run}`,
        'Student Name': `${name('Ten')} Verma`,
        Status: 'ISSUED',
        Reason: 'Relocation',
        'Requested At': '03/11/2025',
        'Issued At': '06/11/2025',
        'Is Duplicate': 'No',
        'Admission Number': `ADM-${name('Ten')}`,
      },
    ]);
    expect(output.rowCount).toBe(1);
    expectNoLeak(output);
  });

  it('Admission register: students admitted during the year, with class names', async () => {
    const output = await generateAwrExport(db, instA.tenantId, yearId);

    const rows = rowsOf(output, 'Admission Register');
    expect(rows.map((r) => r['Admission Number'])).toEqual([
      `ADM-${name('Five')}`,
      `ADM-${name('Nine')}`,
    ]);
    expect(rows[1]).toMatchObject({
      'Admission Date': '10/05/2025',
      'Date of Birth': '03/02/2011',
      Gender: 'Female',
      Class: 'Class 9',
      Section: 'A',
      'Social Category': 'General',
    });
    expect(output.rowCount).toBe(2);
    expectNoLeak(output);
  });
});
