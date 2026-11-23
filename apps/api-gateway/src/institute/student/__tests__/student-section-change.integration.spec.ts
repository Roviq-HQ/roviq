/**
 * updateStudentSection against real PostgreSQL + RLS: the stored move and its event, and another
 * institute's year record or section refused with nothing written.
 */
import { randomUUID } from 'node:crypto';
import { AcademicStatus, AdmissionType, SocialCategory } from '@roviq/common-types';
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
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:student-section-change';

const audit = (tenantId: string) => ({
  tenantId,
  createdBy: SYSTEM_USER_ID,
  updatedBy: SYSTEM_USER_ID,
});

interface Placement {
  studentProfileId: string;
  studentAcademicId: string;
  sectionId: string;
  otherSectionId: string;
}

/** An active year with one class of two sections, and one student placed in the first. */
function addPlacedStudent(db: DrizzleDB, tenantId: string): Promise<Placement> {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const suffix = randomUUID().slice(0, 8);
    const [year] = await tx
      .insert(academicYears)
      .values({
        ...audit(tenantId),
        label: '2026-27',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        isActive: true,
        status: 'ACTIVE' as const,
      })
      .returning({ id: academicYears.id });
    const [standard] = await tx
      .insert(standards)
      .values({
        ...audit(tenantId),
        academicYearId: year.id,
        name: { en: 'Class 3' },
        numericOrder: 3,
        level: 'PRIMARY' as const,
      })
      .returning({ id: standards.id });
    const [first, second] = await tx
      .insert(sections)
      .values(
        ['A', 'B'].map((name, index) => ({
          ...audit(tenantId),
          standardId: standard.id,
          academicYearId: year.id,
          name: { en: name },
          displayLabel: name,
          displayOrder: index + 1,
          capacity: 40,
        })),
      )
      .returning({ id: sections.id });
    const [role] = await tx
      .insert(roles)
      .values({
        name: { en: `Student ${suffix}` },
        scope: 'institute',
        tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: roles.id });
    const [user] = await tx
      .insert(users)
      .values({
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        email: `section_${suffix}@test.local`,
        username: `section_${suffix}`,
        passwordHash: 'not-a-real-hash',
      })
      .returning({ id: users.id });
    await tx.insert(tenantUserProfiles).values({
      ...audit(tenantId),
      userId: user.id,
      firstName: { en: `Student ${suffix}` },
    });
    const [membership] = await tx
      .insert(memberships)
      .values({ ...audit(tenantId), userId: user.id, roleId: role.id, abilities: [] })
      .returning({ id: memberships.id });
    const [profile] = await tx
      .insert(studentProfiles)
      .values({
        ...audit(tenantId),
        userId: user.id,
        membershipId: membership.id,
        admissionNumber: `ADM-${suffix}`,
        admissionDate: '2026-04-01',
        admissionType: AdmissionType.NEW,
        academicStatus: AcademicStatus.ENROLLED,
        socialCategory: SocialCategory.GENERAL,
      })
      .returning({ id: studentProfiles.id });
    const [academic] = await tx
      .insert(studentAcademics)
      .values({
        ...audit(tenantId),
        studentProfileId: profile.id,
        academicYearId: year.id,
        standardId: standard.id,
        sectionId: first.id,
      })
      .returning({ id: studentAcademics.id });
    return {
      studentProfileId: profile.id,
      studentAcademicId: academic.id,
      sectionId: first.id,
      otherSectionId: second.id,
    };
  });
}

function sectionOf(db: DrizzleDB, studentAcademicId: string) {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const [row] = await tx
      .select({ sectionId: studentAcademics.sectionId })
      .from(studentAcademics)
      .where(eq(studentAcademics.id, studentAcademicId));
    return row?.sectionId;
  });
}

const MOVE = `
  mutation Move($input: UpdateStudentSectionInput!) { updateStudentSection(input: $input) }`;

describe('updateStudentSection (integration)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let tokenA: string;
  let placedA: Placement;
  let placedB: Placement;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instA = await createTestInstitute(result.db);
    const instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    placedA = await addPlacedStudent(result.db, instA.tenantId);
    placedB = await addPlacedStudent(result.db, instB.tenantId);
  });

  afterAll(async () => {
    await result?.close();
  });

  it("should refuse another institute's year record with STUDENT_ACADEMIC_NOT_FOUND", async () => {
    const res = await gqlRequest<{ updateStudentSection: string }>(result.httpServer, {
      query: MOVE,
      variables: {
        input: {
          studentAcademicId: placedB.studentAcademicId,
          newSectionId: placedA.otherSectionId,
        },
      },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe('STUDENT_ACADEMIC_NOT_FOUND');
    expect(await sectionOf(result.db, placedB.studentAcademicId)).toBe(placedB.sectionId);
  });

  it("should refuse another institute's section with SECTION_NOT_FOUND", async () => {
    const res = await gqlRequest<{ updateStudentSection: string }>(result.httpServer, {
      query: MOVE,
      variables: {
        input: {
          studentAcademicId: placedA.studentAcademicId,
          newSectionId: placedB.otherSectionId,
        },
      },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe('SECTION_NOT_FOUND');
    expect(await sectionOf(result.db, placedA.studentAcademicId)).toBe(placedA.sectionId);
  });

  it('should move the student to the other section and emit STUDENT.section_changed', async () => {
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    const res = await gqlRequest<{ updateStudentSection: string }>(result.httpServer, {
      query: MOVE,
      variables: {
        input: {
          studentAcademicId: placedA.studentAcademicId,
          newSectionId: placedA.otherSectionId,
        },
      },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.updateStudentSection).toBe(placedA.studentAcademicId);
    expect(await sectionOf(result.db, placedA.studentAcademicId)).toBe(placedA.otherSectionId);
    expect(emit).toHaveBeenCalledWith(EVENT_PATTERNS.STUDENT.section_changed, {
      studentProfileId: placedA.studentProfileId,
      oldSectionId: placedA.sectionId,
      newSectionId: placedA.otherSectionId,
      tenantId: instA.tenantId,
    });
    emit.mockRestore();
  });
});
