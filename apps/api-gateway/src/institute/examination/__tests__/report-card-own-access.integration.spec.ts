/**
 * ROV-217: a student reads only their own published report cards and a parent only their linked
 * children's, through every query that takes a report card or instance id.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_ABILITIES, ErrorCode, GuardianRelationship } from '@roviq/common-types';
import {
  type DrizzleDB,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  reportCardInstances,
  roles,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentProfiles,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { type ExamFixture, setUpExamFixture } from './examination-foreign-id.fixture';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const INSTANCES = 'query ($id: ID!) { reportCardInstances(reportCardId: $id) { id } }';
const INSTANCE = `query ($reportCardId: ID!, $studentProfileId: ID!) {
  reportCardInstance(reportCardId: $reportCardId, studentProfileId: $studentProfileId) { id }
}`;
const PDF = 'query ($id: ID!) { reportCardPdf(instanceId: $id) }';
const CARDS = 'query ($yearId: ID!) { reportCards(academicYearId: $yearId) { id } }';
const CARD = 'query ($id: ID!) { reportCard(id: $id) { id } }';

describe('report cards: a student and a parent read only their own (ROV-217)', () => {
  let result: IntegrationAppResult;
  let inst: TestInstitute;
  let fx: ExamFixture;
  let staffToken: string;
  let studentToken: string;
  let parentToken: string;
  /** On `fx.draftCardId`: published for the student and for a classmate. */
  let ownPublished: string;
  let classmatePublished: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx('test:report-card-own-access'), fn);

  /** A role holding exactly the default abilities of `role`, given to `membershipId`. */
  const giveDefaultRole = (membershipId: string, role: 'student' | 'parent') =>
    asAdmin(async (tx) => {
      const [created] = await tx
        .insert(roles)
        .values({
          tenantId: inst.tenantId,
          name: { en: `${role} ${randomUUID().slice(0, 8)}` },
          abilities: DEFAULT_ROLE_ABILITIES[role],
          ...BY,
        })
        .returning({ id: roles.id });
      await tx
        .update(memberships)
        .set({ roleId: created.id, abilities: [] })
        .where(eq(memberships.id, membershipId));
      return created.id;
    });

  const ask = <T>(query: string, variables: Record<string, unknown>, token: string) =>
    gqlRequest<T>(result.httpServer, { query, variables, token });

  const instanceIds = async (cardId: string, token: string) => {
    const res = await ask<{ reportCardInstances: { id: string }[] }>(
      INSTANCES,
      { id: cardId },
      token,
    );
    expect(res.errors).toBeUndefined();
    return res.data?.reportCardInstances.map((row) => row.id).sort();
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    inst = await createTestInstitute(result.db);
    fx = await setUpExamFixture(result.db, inst);
    staffToken = createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });

    const [student] = await asAdmin((tx) =>
      tx
        .select({ userId: studentProfiles.userId })
        .from(studentProfiles)
        .where(eq(studentProfiles.id, fx.student.profileId)),
    );
    studentToken = createInstituteToken({
      sub: student.userId,
      tenantId: inst.tenantId,
      membershipId: fx.student.membershipId,
      roleId: await giveDefaultRole(fx.student.membershipId, 'student'),
    });

    const parent = await createTestTeacher(result.db, inst.tenantId);
    parentToken = createInstituteToken({
      sub: parent.userId,
      tenantId: inst.tenantId,
      membershipId: parent.membershipId,
      roleId: await giveDefaultRole(parent.membershipId, 'parent'),
    });

    await asAdmin(async (tx) => {
      const [guardian] = await tx
        .insert(guardianProfiles)
        .values({
          tenantId: inst.tenantId,
          userId: parent.userId,
          membershipId: parent.membershipId,
          ...BY,
        })
        .returning({ id: guardianProfiles.id });
      await tx.insert(studentGuardianLinks).values({
        tenantId: inst.tenantId,
        guardianProfileId: guardian.id,
        studentProfileId: fx.student.profileId,
        relationship: GuardianRelationship.MOTHER,
        ...BY,
      });
      const published = await tx
        .insert(reportCardInstances)
        .values(
          [fx.student.profileId, fx.otherStudent.profileId].map((studentProfileId) => ({
            tenantId: inst.tenantId,
            reportCardId: fx.draftCardId,
            studentProfileId,
            academicYearId: fx.yearId,
            status: 'PUBLISHED' as const,
            percentage: 75,
            grade: 'B',
            // A generated card always carries its snapshot; the PDF is drawn from it.
            payload: {
              termName: 'Term 1',
              student: { name: 'Test student', rollNumber: null },
              subjects: [],
              coScholastic: [],
            },
            ...BY,
          })),
        )
        .returning({ id: reportCardInstances.id });
      [ownPublished, classmatePublished] = published.map((row) => row.id);
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should still list every instance to staff who manage report cards', async () => {
    expect(await instanceIds(fx.draftCardId, staffToken)).toEqual(
      [ownPublished, classmatePublished].sort(),
    );
    expect(await instanceIds(fx.generatedCardId, staffToken)).toEqual([fx.instanceId]);
  });

  it.each([
    ['student', () => studentToken],
    ['parent', () => parentToken],
  ])('should list to a %s only the published card of their own student', async (_who, token) => {
    expect(await instanceIds(fx.draftCardId, token())).toEqual([ownPublished]);
    // The student's card on the other report card is generated but not published.
    expect(await instanceIds(fx.generatedCardId, token())).toEqual([]);
  });

  it('should list every report card of the year to staff who manage them', async () => {
    const res = await ask<{ reportCards: { id: string }[] }>(
      CARDS,
      { yearId: fx.yearId },
      staffToken,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.reportCards.map((row) => row.id).sort()).toEqual(
      [fx.draftCardId, fx.generatedCardId, fx.spareCardId].sort(),
    );
  });

  it.each([
    ['student', () => studentToken],
    ['parent', () => parentToken],
  ])('should list to a %s only the report card that holds a published card of their own student', async (_who, token) => {
    const res = await ask<{ reportCards: { id: string }[] }>(CARDS, { yearId: fx.yearId }, token());
    expect(res.errors).toBeUndefined();
    expect(res.data?.reportCards.map((row) => row.id)).toEqual([fx.draftCardId]);
  });

  it.each([
    ['student', () => studentToken],
    ['parent', () => parentToken],
  ])('should refuse a %s a report card with no published card of their own student', async (_who, token) => {
    const own = await ask<{ reportCard: { id: string } }>(CARD, { id: fx.draftCardId }, token());
    expect(own.data?.reportCard.id).toBe(fx.draftCardId);

    const refused = await ask(CARD, { id: fx.generatedCardId }, token());
    expect(refused.errors?.[0]?.extensions?.code).toBe(ErrorCode.REPORT_CARD_NOT_FOUND);
    expect(refused.data).toBeNull();
  });

  it.each([
    ['student', () => studentToken],
    ['parent', () => parentToken],
  ])('should refuse a %s a classmate card and an unpublished one', async (_who, token) => {
    const own = await ask<{ reportCardInstance: { id: string } }>(
      INSTANCE,
      { reportCardId: fx.draftCardId, studentProfileId: fx.student.profileId },
      token(),
    );
    expect(own.data?.reportCardInstance.id).toBe(ownPublished);

    for (const variables of [
      { reportCardId: fx.draftCardId, studentProfileId: fx.otherStudent.profileId },
      { reportCardId: fx.generatedCardId, studentProfileId: fx.student.profileId },
    ]) {
      const refused = await ask(INSTANCE, variables, token());
      expect(refused.errors?.[0]?.extensions?.code).toBe(ErrorCode.REPORT_CARD_NOT_FOUND);
      expect(refused.data).toBeNull();
    }
  });

  it.each([
    ['student', () => studentToken],
    ['parent', () => parentToken],
  ])('should render a %s only their own published PDF', async (_who, token) => {
    const own = await ask<{ reportCardPdf: string }>(PDF, { id: ownPublished }, token());
    expect(own.errors).toBeUndefined();
    expect(own.data?.reportCardPdf.length).toBeGreaterThan(0);

    for (const id of [classmatePublished, fx.instanceId]) {
      const refused = await ask(PDF, { id }, token());
      expect(refused.errors?.[0]?.extensions?.code).toBe(ErrorCode.REPORT_CARD_NOT_FOUND);
      expect(refused.data).toBeNull();
    }
  });

  it('should answer myReportCards with the published cards of the signed-in student only', async () => {
    const MINE = '{ myReportCards { id } }';
    const own = await ask<{ myReportCards: { id: string }[] }>(MINE, {}, studentToken);
    expect(own.errors).toBeUndefined();
    expect(own.data?.myReportCards.map((row) => row.id)).toEqual([ownPublished]);

    // A parent is not a student: the query reads the caller's own student profile.
    const parent = await ask<{ myReportCards: { id: string }[] }>(MINE, {}, parentToken);
    expect(parent.errors).toBeUndefined();
    expect(parent.data?.myReportCards).toEqual([]);
  });
});
