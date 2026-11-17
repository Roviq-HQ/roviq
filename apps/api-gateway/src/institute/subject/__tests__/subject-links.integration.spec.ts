/**
 * Subject ↔ standard / section links: removing a link must take effect.
 * A hard DELETE as `roviq_app` is blocked by RLS and removes nothing, so the
 * repository soft-deletes instead.
 */
import {
  academicYears,
  mkAdminCtx,
  SYSTEM_USER_ID,
  sectionSubjects,
  sectionSubjectsLive,
  sections,
  standardSubjects,
  standardSubjectsLive,
  standards,
  subjects,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

describe('Subject links (integration)', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;
  let token: string;
  let subjectId: string;
  let standardId: string;
  let sectionId: string;

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[2]) =>
    withAdmin(result.db, mkAdminCtx('test:subject-links'), fn);

  async function run(mutation: string, target: 'standardId' | 'sectionId', id: string) {
    const response = await gqlRequest<Record<string, { id: string }>>(result.httpServer, {
      query: `mutation($subjectId: ID!, $target: ID!) { ${mutation}(subjectId: $subjectId, ${target}: $target) { id } }`,
      token,
      variables: { subjectId, target: id },
    });
    expect(response.errors).toBeUndefined();
  }

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    institute = await createTestInstitute(result.db);
    token = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
    const audit = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
    const tenantId = institute.tenantId;
    await admin(async (tx) => {
      const [year] = await tx
        .insert(academicYears)
        .values({
          tenantId,
          label: '2025-26',
          startDate: '2025-04-01',
          endDate: '2026-03-31',
          isActive: false,
          ...audit,
        })
        .returning({ id: academicYears.id });
      const [standard] = await tx
        .insert(standards)
        .values({
          tenantId,
          academicYearId: year.id,
          name: { en: 'Class 5' },
          numericOrder: 5,
          level: 'PRIMARY',
          ...audit,
        })
        .returning({ id: standards.id });
      const [section] = await tx
        .insert(sections)
        .values({
          tenantId,
          standardId: standard.id,
          academicYearId: year.id,
          name: { en: 'A' },
          displayLabel: 'Class 5-A',
          capacity: 40,
          ...audit,
        })
        .returning({ id: sections.id });
      const [subject] = await tx
        .insert(subjects)
        .values({ tenantId, name: 'Mathematics', ...audit })
        .returning({ id: subjects.id });
      standardId = standard.id;
      sectionId = section.id;
      subjectId = subject.id;
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('removeSubjectFromStandard soft-deletes the link and allows re-assigning', async () => {
    await run('assignSubjectToStandard', 'standardId', standardId);
    await run('removeSubjectFromStandard', 'standardId', standardId);

    const pair = and(
      eq(standardSubjects.subjectId, subjectId),
      eq(standardSubjects.standardId, standardId),
    );
    const base = await admin((tx) =>
      tx
        .select({ deletedAt: standardSubjects.deletedAt, deletedBy: standardSubjects.deletedBy })
        .from(standardSubjects)
        .where(pair),
    );
    expect(base).toHaveLength(1);
    expect(base[0].deletedAt).toBeInstanceOf(Date);
    expect(base[0].deletedBy).toBe(institute.userId);

    const liveCount = () =>
      admin((tx) =>
        tx
          .select({ id: standardSubjectsLive.id })
          .from(standardSubjectsLive)
          .where(
            and(
              eq(standardSubjectsLive.subjectId, subjectId),
              eq(standardSubjectsLive.standardId, standardId),
            ),
          ),
      );
    expect(await liveCount()).toEqual([]);

    await run('assignSubjectToStandard', 'standardId', standardId);
    expect(await liveCount()).toHaveLength(1);
  });

  it('removeSubjectFromSection soft-deletes the link and allows re-assigning', async () => {
    await run('assignSubjectToSection', 'sectionId', sectionId);
    await run('removeSubjectFromSection', 'sectionId', sectionId);

    const base = await admin((tx) =>
      tx
        .select({ deletedAt: sectionSubjects.deletedAt, deletedBy: sectionSubjects.deletedBy })
        .from(sectionSubjects)
        .where(
          and(eq(sectionSubjects.subjectId, subjectId), eq(sectionSubjects.sectionId, sectionId)),
        ),
    );
    expect(base).toHaveLength(1);
    expect(base[0].deletedAt).toBeInstanceOf(Date);
    expect(base[0].deletedBy).toBe(institute.userId);

    const liveCount = () =>
      admin((tx) =>
        tx
          .select({ id: sectionSubjectsLive.id })
          .from(sectionSubjectsLive)
          .where(
            and(
              eq(sectionSubjectsLive.subjectId, subjectId),
              eq(sectionSubjectsLive.sectionId, sectionId),
            ),
          ),
      );
    expect(await liveCount()).toEqual([]);

    await run('assignSubjectToSection', 'sectionId', sectionId);
    expect(await liveCount()).toHaveLength(1);
  });
});
