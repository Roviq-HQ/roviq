/**
 * ROV-275: a bulk import row is admitted in one institute transaction. A row that fails leaves
 * no institute row and no account behind, and does not stop the rows after it.
 */
import { DefaultRoles, Gender } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
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
import { createMock } from '@roviq/testing';
import {
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { IdentityService } from '../../../auth/identity.service';
import { createBulkStudentImportActivities } from '../workflows/bulk-student-import.activities';
import type { ImportFileStore, ValidatedRow } from '../workflows/bulk-student-import.types';

const ORIGIN = 'test:student-bulk-import-atomic';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

describe('bulk import insertBatch: one transaction per row (ROV-275)', () => {
  let result: IntegrationAppResult;
  let inst: TestInstitute;
  let yearId: string;
  let standardId: string;
  let liveSectionId: string;
  let deletedSectionId: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const written = () =>
    asAdmin(async (tx) => ({
      users: await tx.select({ id: users.id }).from(users).where(eq(users.createdBy, inst.userId)),
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
        .select({ id: studentProfiles.id })
        .from(studentProfiles)
        .where(eq(studentProfiles.tenantId, inst.tenantId)),
      academics: await tx
        .select({ sectionId: studentAcademics.sectionId, rollNumber: studentAcademics.rollNumber })
        .from(studentAcademics)
        .where(eq(studentAcademics.tenantId, inst.tenantId)),
    }));

  const row = (rowNumber: number, firstName: string, sectionId?: string): ValidatedRow => ({
    rowNumber,
    firstName,
    lastName: 'Rao',
    dateOfBirth: '2015-06-01',
    gender: Gender.FEMALE,
    sectionId,
  });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    inst = await createTestInstitute(result.db);
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
          name: { en: 'Class 4' },
          numericOrder: 4,
          level: 'PRIMARY',
          ...BY,
        })
        .returning({ id: standards.id });
      const added = await tx
        .insert(sections)
        .values(
          ['A', 'B'].map((name) => ({
            tenantId: inst.tenantId,
            standardId: standard.id,
            academicYearId: year.id,
            name: { en: name },
            displayLabel: `Class 4-${name}`,
            capacity: 40,
            ...BY,
          })),
        )
        .returning({ id: sections.id });
      await tx
        .update(sections)
        .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
        .where(eq(sections.id, added[1].id));
      yearId = year.id;
      standardId = standard.id;
      liveSectionId = added[0].id;
      deletedSectionId = added[1].id;
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should leave nothing for a failed row and still admit the rows around it', async () => {
    const activities = createBulkStudentImportActivities(
      result.db,
      null,
      result.app.get(IdentityService),
      createMock<ImportFileStore>(),
    );
    const before = await written();

    const outcome = await activities.insertBatch(
      inst.tenantId,
      yearId,
      standardId,
      liveSectionId,
      inst.userId,
      [row(1, 'Anika'), row(2, 'Bela', deletedSectionId), row(3, 'Chhavi')],
    );

    expect(outcome.created).toBe(2);
    expect(outcome.skipped).toBe(0);
    expect(outcome.errors.map((e) => e.rowNumber)).toEqual([2]);
    const after = await written();
    expect(after.users).toHaveLength(before.users.length + 2);
    expect(after.memberships).toHaveLength(before.memberships.length + 2);
    expect(after.copies).toHaveLength(before.copies.length + 2);
    expect(after.profiles).toHaveLength(before.profiles.length + 2);
    // Roll numbers come from the same transaction: the failed row used none.
    expect(after.academics.map((a) => a.rollNumber).sort()).toEqual(['0001', '0002']);
    expect(after.academics.every((a) => a.sectionId === liveSectionId)).toBe(true);
  });
});
