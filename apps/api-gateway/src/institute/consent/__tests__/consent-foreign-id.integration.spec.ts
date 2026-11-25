/**
 * ROV-293: consent operations refuse a student of another institute, return none of its
 * consent records and write no consent record in either institute.
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  DEFAULT_ROLE_ABILITIES,
  ErrorCode,
  SocialCategory,
} from '@roviq/common-types';
import {
  consentRecords,
  type DrizzleDB,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentProfiles,
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
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:consent-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const PURPOSE = 'PHOTO_VIDEO_MARKETING';

const GRANT = /* GraphQL */ `
  mutation GrantConsent($studentProfileId: ID!) {
    grantConsent(input: { studentProfileId: $studentProfileId, purpose: ${PURPOSE} }) {
      id
    }
  }
`;
const WITHDRAW = /* GraphQL */ `
  mutation WithdrawConsent($studentProfileId: ID!) {
    withdrawConsent(input: { studentProfileId: $studentProfileId, purpose: ${PURPOSE} }) {
      id
    }
  }
`;
const STATUS = /* GraphQL */ `
  query ConsentStatusForStudent($studentProfileId: ID!) {
    consentStatusForStudent(studentProfileId: $studentProfileId) {
      studentProfileId
      purpose
      isGranted
    }
  }
`;

describe('consent: a student of another institute (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let ownStudentId: string;
  let foreignStudentId: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const consentsOf = (tenantId: string) =>
    asAdmin((tx) =>
      tx
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.tenantId, tenantId))
        .orderBy(consentRecords.id),
    );

  const consentsPointingAtForeignStudent = () =>
    asAdmin((tx) =>
      tx
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.studentProfileId, foreignStudentId))
        .orderBy(consentRecords.id),
    );

  const insertUserWithMembership = async (tx: DrizzleDB, inst: TestInstitute, kind: string) => {
    const suffix = randomUUID().slice(0, 8);
    const [user] = await tx
      .insert(users)
      .values({
        email: `consent_${kind}_${suffix}@test.local`,
        username: `consent_${kind}_${suffix}`,
        passwordHash: 'not-a-real-hash',
        ...BY,
      })
      .returning({ id: users.id });
    const [membership] = await tx
      .insert(memberships)
      .values({
        userId: user.id,
        roleId: inst.roleId,
        tenantId: inst.tenantId,
        abilities: [],
        ...BY,
      })
      .returning({ id: memberships.id });
    return { userId: user.id, membershipId: membership.id };
  };

  const insertStudent = (tx: DrizzleDB, inst: TestInstitute) =>
    insertUserWithMembership(tx, inst, 'student').then(async ({ userId, membershipId }) => {
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId: inst.tenantId,
          userId,
          membershipId,
          admissionNumber: `ADM-${randomUUID().slice(0, 8)}`,
          admissionDate: '2026-04-01',
          admissionType: AdmissionType.NEW,
          academicStatus: AcademicStatus.ENROLLED,
          socialCategory: SocialCategory.GENERAL,
          ...BY,
        })
        .returning({ id: studentProfiles.id });
      return profile.id;
    });

  const linkGuardian = async (
    tx: DrizzleDB,
    inst: TestInstitute,
    guardian: { userId: string; membershipId: string },
    studentProfileId: string,
  ) => {
    const [profile] = await tx
      .insert(guardianProfiles)
      .values({ tenantId: inst.tenantId, ...guardian, ...BY })
      .returning({ id: guardianProfiles.id });
    await tx.insert(studentGuardianLinks).values({
      tenantId: inst.tenantId,
      studentProfileId,
      guardianProfileId: profile.id,
      relationship: 'MOTHER',
      isPrimaryContact: true,
      ...BY,
    });
    return profile.id;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    await asAdmin(async (tx) => {
      // The caller is a guardian of its own institute's student, so only the foreign id differs.
      ownStudentId = await insertStudent(tx, instA);
      await linkGuardian(
        tx,
        instA,
        { userId: instA.userId, membershipId: instA.membershipId },
        ownStudentId,
      );
      foreignStudentId = await insertStudent(tx, instB);
      const foreignGuardian = await insertUserWithMembership(tx, instB, 'guardian');
      const foreignGuardianProfileId = await linkGuardian(
        tx,
        instB,
        foreignGuardian,
        foreignStudentId,
      );
      await tx.insert(consentRecords).values({
        tenantId: instB.tenantId,
        guardianProfileId: foreignGuardianProfileId,
        studentProfileId: foreignStudentId,
        purpose: PURPOSE,
        isGranted: true,
        grantedAt: new Date(),
      });
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  it.each([
    ['grantConsent', GRANT],
    ['withdrawConsent', WITHDRAW],
  ] as const)('%s should record consent for its own linked student', async (operation, query) => {
    const res = await gqlRequest<Record<string, { id: string }>>(result.httpServer, {
      query,
      variables: { studentProfileId: ownStudentId },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    const id = res.data?.[operation]?.id;
    const [row] = await asAdmin((tx) =>
      tx
        .select({
          tenantId: consentRecords.tenantId,
          studentProfileId: consentRecords.studentProfileId,
        })
        .from(consentRecords)
        .where(eq(consentRecords.id, id ?? '')),
    );
    expect(row).toEqual({ tenantId: instA.tenantId, studentProfileId: ownStudentId });
  });

  it.each([
    ['grantConsent', GRANT],
    ['withdrawConsent', WITHDRAW],
  ] as const)('%s should refuse a student of another institute and write no consent record', async (_operation, query) => {
    const ownBefore = await consentsOf(instA.tenantId);
    const otherBefore = await consentsOf(instB.tenantId);
    const pointingBefore = await consentsPointingAtForeignStudent();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await gqlRequest(result.httpServer, {
      query,
      variables: { studentProfileId: foreignStudentId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
    expect(res.data).toBeNull();
    expect(await consentsOf(instA.tenantId)).toEqual(ownBefore);
    expect(await consentsOf(instB.tenantId)).toEqual(otherBefore);
    expect(await consentsPointingAtForeignStudent()).toEqual(pointingBefore);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });

  it('consentStatusForStudent should return none of the consent records of another institute student', async () => {
    expect(await consentsPointingAtForeignStudent()).toHaveLength(1);

    const res = await gqlRequest<{ consentStatusForStudent: unknown[] }>(result.httpServer, {
      query: STATUS,
      variables: { studentProfileId: foreignStudentId },
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.consentStatusForStudent).toEqual([]);
  });

  // ROV-217: a parent's consent rule covers only their linked children.
  it("consentStatusForStudent should answer a parent for their own child and refuse another family's", async () => {
    const { parentToken, ownChildId, otherChildId } = await asAdmin(async (tx) => {
      const [parentRole] = await tx
        .insert(roles)
        .values({
          tenantId: instA.tenantId,
          name: { en: `parent ${randomUUID().slice(0, 8)}` },
          abilities: DEFAULT_ROLE_ABILITIES.parent,
          ...BY,
        })
        .returning({ id: roles.id });
      const parent = await insertUserWithMembership(tx, instA, 'parent');
      await tx
        .update(memberships)
        .set({ roleId: parentRole.id })
        .where(eq(memberships.id, parent.membershipId));
      const ownChild = await insertStudent(tx, instA);
      await linkGuardian(tx, instA, parent, ownChild);
      const otherChild = await insertStudent(tx, instA);
      const otherParent = await insertUserWithMembership(tx, instA, 'other_parent');
      await linkGuardian(tx, instA, otherParent, otherChild);
      return {
        ownChildId: ownChild,
        otherChildId: otherChild,
        parentToken: createInstituteToken({
          sub: parent.userId,
          tenantId: instA.tenantId,
          membershipId: parent.membershipId,
          roleId: parentRole.id,
        }),
      };
    });

    const own = await gqlRequest(result.httpServer, {
      query: STATUS,
      variables: { studentProfileId: ownChildId },
      token: parentToken,
    });
    expect(own.errors).toBeUndefined();

    const other = await gqlRequest(result.httpServer, {
      query: STATUS,
      variables: { studentProfileId: otherChildId },
      token: parentToken,
    });
    expect(other.errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
    expect(other.data).toBeNull();
  });

  it('grantConsent refuses a purpose in the old lowercase form before writing (ROV-227)', async () => {
    const before = await consentsOf(instA.tenantId);
    // gqlRequest throws on the HTTP 400 that a variable of the wrong enum value returns.
    await expect(
      gqlRequest(result.httpServer, {
        query: `mutation($input: GrantConsentInput!) { grantConsent(input: $input) { id } }`,
        variables: {
          input: { studentProfileId: ownStudentId, purpose: 'photo_video_marketing' },
        },
        token: tokenA,
      }),
    ).rejects.toThrow(/photo_video_marketing.*ConsentPurpose/);
    expect(await consentsOf(instA.tenantId)).toEqual(before);
  });
});
