/**
 * sections.current_strength is kept by database triggers (ROV-232): no code path bumps it.
 * These tests write the way seeders and services do and read the counter back.
 */
import { randomUUID } from 'node:crypto';
import { AcademicStatus, AdmissionType, SocialCategory } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  mkInstituteCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  users,
  withAdmin,
  withTenant,
} from '@roviq/database';
import {
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

describe('section strength triggers (integration)', () => {
  let result: IntegrationAppResult;
  let db: DrizzleDB;
  let tenantId: string;
  let yearId: string;
  let standardId: string;
  let roleId: string;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    db = result.db;
    tenantId = (await createTestInstitute(db)).tenantId;
    await withAdmin(db, mkAdminCtx('test:section-strength'), async (tx) => {
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
      const [role] = await tx
        .insert(roles)
        .values({
          name: { en: `Strength Role ${randomUUID().slice(0, 8)}` },
          scope: 'institute',
          tenantId,
          abilities: [],
          isDefault: false,
          isSystem: false,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: roles.id });
      yearId = year.id;
      standardId = std.id;
      roleId = role.id;
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  const createSection = async (label: string): Promise<string> => {
    const [section] = await withAdmin(db, mkAdminCtx('test:section-strength'), (tx) =>
      tx
        .insert(sections)
        .values({
          tenantId,
          standardId,
          academicYearId: yearId,
          name: { en: label },
          displayLabel: `Class 5-${label}`,
          capacity: 40,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: sections.id }),
    );
    return section.id;
  };

  const createStudent = async (): Promise<string> => {
    const suffix = randomUUID().slice(0, 8);
    return withAdmin(db, mkAdminCtx('test:section-strength'), async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          email: `strength_${suffix}@test.local`,
          username: `strength_${suffix}`,
          passwordHash: 'not-a-real-hash',
        })
        .returning({ id: users.id });
      const [membership] = await tx
        .insert(memberships)
        .values({
          userId: user.id,
          roleId,
          tenantId,
          abilities: [],
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: memberships.id });
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId,
          userId: user.id,
          membershipId: membership.id,
          admissionNumber: `STR-${suffix}`,
          admissionDate: '2025-04-01',
          admissionType: AdmissionType.NEW,
          academicStatus: AcademicStatus.ENROLLED,
          socialCategory: SocialCategory.GENERAL,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: studentProfiles.id });
      return profile.id;
    });
  };

  // Written as the institute role, the way services and workflow activities write.
  const enrol = async (studentProfileId: string, sectionId: string): Promise<string> => {
    const [row] = await withTenant(db, mkInstituteCtx(tenantId, 'test:section-strength'), (tx) =>
      tx
        .insert(studentAcademics)
        .values({
          tenantId,
          studentProfileId,
          academicYearId: yearId,
          standardId,
          sectionId,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: studentAcademics.id }),
    );
    return row.id;
  };

  const strength = async (sectionId: string): Promise<number | undefined> => {
    const rows = await withAdmin(db, mkAdminCtx('test:section-strength'), (tx) =>
      tx
        .select({ currentStrength: sections.currentStrength })
        .from(sections)
        .where(eq(sections.id, sectionId)),
    );
    return rows[0]?.currentStrength;
  };

  it('counts enrolments as they are inserted, including concurrent ones', async () => {
    const section = await createSection('A');
    const students = await Promise.all([createStudent(), createStudent(), createStudent()]);

    await Promise.all(students.map((student) => enrol(student, section)));

    expect(await strength(section)).toBe(3);
  });

  it('counts every section of one multi-row insert, update and delete', async () => {
    const first = await createSection('F');
    const second = await createSection('G');
    const third = await createSection('H');
    const students = await Promise.all(Array.from({ length: 5 }, () => createStudent()));
    const targets = [first, first, first, second, second];

    const rows = await withTenant(db, mkInstituteCtx(tenantId, 'test:section-strength'), (tx) =>
      tx
        .insert(studentAcademics)
        .values(
          students.map((studentProfileId, index) => ({
            tenantId,
            studentProfileId,
            academicYearId: yearId,
            standardId,
            sectionId: targets[index],
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })),
        )
        .returning({ id: studentAcademics.id, sectionId: studentAcademics.sectionId }),
    );
    expect(await strength(first)).toBe(3);
    expect(await strength(second)).toBe(2);

    await withTenant(db, mkInstituteCtx(tenantId, 'test:section-strength'), (tx) =>
      tx
        .update(studentAcademics)
        .set({ sectionId: third })
        .where(
          inArray(
            studentAcademics.id,
            rows.map((row) => row.id),
          ),
        ),
    );
    expect(await strength(first)).toBe(0);
    expect(await strength(second)).toBe(0);
    expect(await strength(third)).toBe(5);

    await withAdmin(db, mkAdminCtx('test:section-strength'), (tx) =>
      tx.delete(studentAcademics).where(
        inArray(
          studentAcademics.id,
          rows.slice(0, 2).map((row) => row.id),
        ),
      ),
    );
    expect(await strength(third)).toBe(3);
  });

  it('recounts once for a status change of many students in one statement', async () => {
    const section = await createSection('I');
    const other = await createSection('J');
    const students = await Promise.all(Array.from({ length: 4 }, () => createStudent()));
    await Promise.all(students.slice(0, 3).map((student) => enrol(student, section)));
    await enrol(students[3], other);

    await withTenant(db, mkInstituteCtx(tenantId, 'test:section-strength'), (tx) =>
      tx
        .update(studentProfiles)
        .set({ academicStatus: AcademicStatus.TRANSFERRED_OUT })
        .where(inArray(studentProfiles.id, [students[0], students[1], students[3]])),
    );

    expect(await strength(section)).toBe(1);
    expect(await strength(other)).toBe(0);
  });

  it('leaves the count alone when an update changes nothing that is counted', async () => {
    const section = await createSection('K');
    const academicId = await enrol(await createStudent(), section);
    // A wrong counter would be overwritten by a recount; it must survive this update.
    await withAdmin(db, mkAdminCtx('test:section-strength'), (tx) =>
      tx.update(sections).set({ currentStrength: 7 }).where(eq(sections.id, section)),
    );

    await withTenant(db, mkInstituteCtx(tenantId, 'test:section-strength'), (tx) =>
      tx
        .update(studentAcademics)
        .set({ rollNumber: '12' })
        .where(eq(studentAcademics.id, academicId)),
    );

    expect(await strength(section)).toBe(7);
  });

  it('moves the count when a student changes section', async () => {
    const from = await createSection('B');
    const to = await createSection('C');
    const academicId = await enrol(await createStudent(), from);

    await withTenant(db, mkInstituteCtx(tenantId, 'test:section-strength'), (tx) =>
      tx.update(studentAcademics).set({ sectionId: to }).where(eq(studentAcademics.id, academicId)),
    );

    expect(await strength(from)).toBe(0);
    expect(await strength(to)).toBe(1);
  });

  it('drops a student who is no longer enrolled and counts them again on return', async () => {
    const section = await createSection('D');
    const student = await createStudent();
    await enrol(student, section);
    const setStatus = (academicStatus: AcademicStatus) =>
      withTenant(db, mkInstituteCtx(tenantId, 'test:section-strength'), (tx) =>
        tx.update(studentProfiles).set({ academicStatus }).where(eq(studentProfiles.id, student)),
      );

    await setStatus(AcademicStatus.TRANSFERRED_OUT);
    expect(await strength(section)).toBe(0);

    await setStatus(AcademicStatus.ENROLLED);
    expect(await strength(section)).toBe(1);
  });

  it('drops a soft-deleted enrolment', async () => {
    const section = await createSection('E');
    const academicId = await enrol(await createStudent(), section);

    await withTenant(db, mkInstituteCtx(tenantId, 'test:section-strength'), (tx) =>
      tx
        .update(studentAcademics)
        .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
        .where(eq(studentAcademics.id, academicId)),
    );

    expect(await strength(section)).toBe(0);
  });
});
