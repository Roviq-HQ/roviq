/**
 * ROV-293: every guardian operation that takes an id refuses a guardian or student of another
 * institute, returns none of its data, and stores or changes no link to it.
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  ErrorCode,
  GuardianRelationship,
  SocialCategory,
} from '@roviq/common-types';
import {
  type DrizzleDB,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentProfiles,
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
import { and, eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:guardian-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const GET = /* GraphQL */ `
  query GetGuardian($id: ID!) {
    getGuardian(id: $id) {
      id
      occupation
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateGuardian($id: ID!) {
    updateGuardian(
      id: $id
      input: { version: 1, firstName: { en: "Renamed" }, occupation: "Pilot" }
    ) {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteGuardian($id: ID!) {
    deleteGuardian(id: $id)
  }
`;
const RESTORE = /* GraphQL */ `
  mutation RestoreGuardian($id: ID!) {
    restoreGuardian(id: $id)
  }
`;
const LINK = /* GraphQL */ `
  mutation LinkGuardianToStudent($input: LinkGuardianInput!) {
    linkGuardianToStudent(input: $input) {
      id
    }
  }
`;
const UNLINK = /* GraphQL */ `
  mutation UnlinkGuardianFromStudent($input: UnlinkGuardianInput!) {
    unlinkGuardianFromStudent(input: $input)
  }
`;
const REVOKE = /* GraphQL */ `
  mutation RevokeGuardianAccess($input: RevokeGuardianAccessInput!) {
    revokeGuardianAccess(input: $input) {
      id
      canPickup
      isPrimaryContact
    }
  }
`;
const RESTORE_ACCESS = /* GraphQL */ `
  mutation RestoreGuardianAccess($input: RestoreGuardianAccessInput!) {
    restoreGuardianAccess(input: $input) {
      id
      accessRevokedAt
    }
  }
`;
const LINKED_STUDENTS = /* GraphQL */ `
  query ListLinkedStudents($id: ID!) {
    listLinkedStudents(guardianProfileId: $id) {
      studentProfileId
    }
  }
`;
const STUDENT_GUARDIANS = /* GraphQL */ `
  query ListStudentGuardians($id: ID!) {
    listStudentGuardians(studentProfileId: $id) {
      guardianProfileId
      isPrimaryContact
    }
  }
`;

interface Fixture {
  /** Linked to g1 (primary contact) and g2. */
  s1: string;
  /** Linked to g1 (primary contact) and g2; the normal cases change it. */
  s2: string;
  g1: string;
  g2: string;
  /** Linked to no student. */
  g3: string;
  /** Soft-deleted. */
  gDeleted: string;
}

describe('guardian: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Fixture;
  let b: Fixture;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /**
   * Guardian, link, membership and profile-copy rows of both institutes, and every link in any
   * institute to B's students or guardians.
   */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      return {
        guardians: await tx
          .select()
          .from(guardianProfiles)
          .where(inArray(guardianProfiles.tenantId, tenants))
          .orderBy(guardianProfiles.id),
        links: await tx
          .select()
          .from(studentGuardianLinks)
          .where(
            or(
              inArray(studentGuardianLinks.tenantId, tenants),
              inArray(studentGuardianLinks.studentProfileId, [b.s1, b.s2]),
              inArray(studentGuardianLinks.guardianProfileId, [b.g1, b.g2, b.g3, b.gDeleted]),
            ),
          )
          .orderBy(studentGuardianLinks.id),
        memberships: await tx
          .select()
          .from(memberships)
          .where(inArray(memberships.tenantId, tenants))
          .orderBy(memberships.id),
        copies: await tx
          .select()
          .from(tenantUserProfiles)
          .where(inArray(tenantUserProfiles.tenantId, tenants))
          .orderBy(tenantUserProfiles.id),
      };
    });

  /** A user with its account profile, the institute's copy and a membership. */
  const addPerson = async (tx: DrizzleDB, inst: TestInstitute, firstName: string) => {
    const suffix = randomUUID().slice(0, 8);
    const [user] = await tx
      .insert(users)
      .values({
        email: `guardian_fid_${suffix}@test.local`,
        username: `guardian_fid_${suffix}`,
        passwordHash: 'not-a-real-hash',
        ...BY,
      })
      .returning({ id: users.id });
    await tx.insert(userProfiles).values({ userId: user.id, firstName: { en: firstName }, ...BY });
    await tx.insert(tenantUserProfiles).values({
      tenantId: inst.tenantId,
      userId: user.id,
      firstName: { en: firstName },
      ...BY,
    });
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
    return { userId: user.id, membershipId: membership.id, suffix };
  };

  const setUp = (inst: TestInstitute) =>
    asAdmin(async (tx): Promise<Fixture> => {
      const addStudent = async (name: string) => {
        const person = await addPerson(tx, inst, name);
        const [profile] = await tx
          .insert(studentProfiles)
          .values({
            tenantId: inst.tenantId,
            userId: person.userId,
            membershipId: person.membershipId,
            admissionNumber: `ADM-${person.suffix}`,
            admissionDate: '2026-04-01',
            admissionType: AdmissionType.NEW,
            academicStatus: AcademicStatus.ENROLLED,
            socialCategory: SocialCategory.GENERAL,
            ...BY,
          })
          .returning({ id: studentProfiles.id });
        return profile.id;
      };
      const addGuardian = async (name: string, deletedAt: Date | null = null) => {
        const person = await addPerson(tx, inst, name);
        const [profile] = await tx
          .insert(guardianProfiles)
          .values({
            tenantId: inst.tenantId,
            userId: person.userId,
            membershipId: person.membershipId,
            occupation: 'Engineer',
            deletedAt,
            deletedBy: deletedAt ? SYSTEM_USER_ID : null,
            ...BY,
          })
          .returning({ id: guardianProfiles.id });
        return profile.id;
      };
      const s1 = await addStudent('Aarav');
      const s2 = await addStudent('Diya');
      const g1 = await addGuardian('Sunita');
      const g2 = await addGuardian('Ramesh');
      const g3 = await addGuardian('Kavita');
      const gDeleted = await addGuardian('Mohan', new Date());
      for (const studentProfileId of [s1, s2]) {
        await tx.insert(studentGuardianLinks).values([
          {
            tenantId: inst.tenantId,
            studentProfileId,
            guardianProfileId: g1,
            relationship: GuardianRelationship.MOTHER,
            isPrimaryContact: true,
            ...BY,
          },
          {
            tenantId: inst.tenantId,
            studentProfileId,
            guardianProfileId: g2,
            relationship: GuardianRelationship.FATHER,
            ...BY,
          },
        ]);
      }
      return { s1, s2, g1, g2, g3, gDeleted };
    });

  const refusesAndWritesNothing = async (
    query: string,
    variables: Record<string, unknown>,
    code: string,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await gqlRequest(result.httpServer, { query, variables, token: tokenA });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  };

  const linkRow = (studentProfileId: string, guardianProfileId: string) =>
    asAdmin((tx) =>
      tx
        .select({
          tenantId: studentGuardianLinks.tenantId,
          isPrimaryContact: studentGuardianLinks.isPrimaryContact,
          canPickup: studentGuardianLinks.canPickup,
          deleted: studentGuardianLinks.deletedAt,
        })
        .from(studentGuardianLinks)
        .where(
          and(
            eq(studentGuardianLinks.studentProfileId, studentProfileId),
            eq(studentGuardianLinks.guardianProfileId, guardianProfileId),
          ),
        ),
    );

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
    a = await setUp(instA);
    b = await setUp(instB);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('getGuardian should refuse a guardian of another institute and return none of it', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: GET,
      variables: { id: b.g1 },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.GUARDIAN_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it.each([
    ['updateGuardian', UPDATE, () => b.g1],
    ['deleteGuardian', DELETE, () => b.g3],
    ['restoreGuardian', RESTORE, () => b.gDeleted],
  ] as const)('%s should refuse a guardian of another institute and change neither institute', async (_operation, query, id) => {
    await refusesAndWritesNothing(query, { id: id() }, ErrorCode.GUARDIAN_NOT_FOUND);
  });

  it('deleteGuardian should refuse a linked guardian of another institute and change neither institute', async () => {
    await refusesAndWritesNothing(DELETE, { id: b.g1 }, ErrorCode.GUARDIAN_NOT_FOUND);
  });

  it('listLinkedStudents should list its own guardian and nothing of another institute guardian', async () => {
    const own = await gqlRequest<{ listLinkedStudents: { studentProfileId: string }[] }>(
      result.httpServer,
      { query: LINKED_STUDENTS, variables: { id: a.g2 }, token: tokenA },
    );
    const foreign = await gqlRequest<{ listLinkedStudents: { studentProfileId: string }[] }>(
      result.httpServer,
      { query: LINKED_STUDENTS, variables: { id: b.g2 }, token: tokenA },
    );

    expect(own.errors).toBeUndefined();
    expect(own.data?.listLinkedStudents.map((row) => row.studentProfileId).sort()).toEqual(
      [a.s1, a.s2].sort(),
    );
    expect(foreign.errors).toBeUndefined();
    expect(foreign.data?.listLinkedStudents).toEqual([]);
  });

  it('listStudentGuardians should list its own student and nothing of another institute student', async () => {
    const own = await gqlRequest<{
      listStudentGuardians: { guardianProfileId: string; isPrimaryContact: boolean }[];
    }>(result.httpServer, { query: STUDENT_GUARDIANS, variables: { id: a.s1 }, token: tokenA });
    const foreign = await gqlRequest<{ listStudentGuardians: unknown[] }>(result.httpServer, {
      query: STUDENT_GUARDIANS,
      variables: { id: b.s1 },
      token: tokenA,
    });

    expect(own.errors).toBeUndefined();
    expect(
      [...(own.data?.listStudentGuardians ?? [])].sort((x, y) =>
        x.guardianProfileId.localeCompare(y.guardianProfileId),
      ),
    ).toEqual(
      [
        { guardianProfileId: a.g1, isPrimaryContact: true },
        { guardianProfileId: a.g2, isPrimaryContact: false },
      ].sort((x, y) => x.guardianProfileId.localeCompare(y.guardianProfileId)),
    );
    expect(foreign.errors).toBeUndefined();
    expect(foreign.data?.listStudentGuardians).toEqual([]);
  });

  describe('linkGuardianToStudent', () => {
    const link = (studentProfileId: string, guardianProfileId: string) => ({
      input: {
        studentProfileId,
        guardianProfileId,
        relationship: GuardianRelationship.LEGAL_GUARDIAN,
        // A primary link first clears the student's current primary contact.
        isPrimaryContact: true,
      },
    });

    it.each([
      ['studentProfileId', () => link(b.s1, a.g3), ErrorCode.STUDENT_NOT_FOUND],
      ['guardianProfileId', () => link(a.s1, b.g3), ErrorCode.GUARDIAN_NOT_FOUND],
      ['both ids', () => link(b.s1, b.g3), ErrorCode.STUDENT_NOT_FOUND],
    ] as const)('should refuse %s of another institute and store or change no link', async (_field, variables, code) => {
      await refusesAndWritesNothing(LINK, variables(), code);
    });

    it('should link its own guardian to its own student as the primary contact', async () => {
      const res = await gqlRequest<{ linkGuardianToStudent: { id: string } }>(result.httpServer, {
        query: LINK,
        variables: link(a.s2, a.g3),
        token: tokenA,
      });

      expect(res.errors).toBeUndefined();
      expect(await linkRow(a.s2, a.g3)).toEqual([
        { tenantId: instA.tenantId, isPrimaryContact: true, canPickup: true, deleted: null },
      ]);
      expect(await linkRow(a.s2, a.g1)).toEqual([
        { tenantId: instA.tenantId, isPrimaryContact: false, canPickup: true, deleted: null },
      ]);
    });
  });

  describe('revokeGuardianAccess', () => {
    const revoke = (studentProfileId: string, guardianProfileId: string) => ({
      input: { studentProfileId, guardianProfileId, reason: 'Family court order' },
    });

    it.each([
      ['studentProfileId', () => revoke(b.s1, a.g1)],
      ['guardianProfileId', () => revoke(a.s1, b.g1)],
      ['both ids', () => revoke(b.s1, b.g1)],
    ] as const)('should refuse %s of another institute and change no link', async (_field, variables) => {
      await refusesAndWritesNothing(REVOKE, variables(), ErrorCode.GUARDIAN_LINK_NOT_FOUND);
    });

    it('should revoke its own guardian on its own student', async () => {
      const res = await gqlRequest<{ revokeGuardianAccess: { canPickup: boolean } }>(
        result.httpServer,
        { query: REVOKE, variables: revoke(a.s2, a.g2), token: tokenA },
      );

      expect(res.errors).toBeUndefined();
      expect(await linkRow(a.s2, a.g2)).toEqual([
        { tenantId: instA.tenantId, isPrimaryContact: false, canPickup: false, deleted: null },
      ]);
    });
  });

  describe('restoreGuardianAccess', () => {
    const restore = (studentProfileId: string, guardianProfileId: string) => ({
      input: { studentProfileId, guardianProfileId },
    });
    const revokedAt = (studentProfileId: string, guardianProfileId: string) =>
      asAdmin(async (tx) => {
        const [row] = await tx
          .select({ at: studentGuardianLinks.accessRevokedAt })
          .from(studentGuardianLinks)
          .where(
            and(
              eq(studentGuardianLinks.studentProfileId, studentProfileId),
              eq(studentGuardianLinks.guardianProfileId, guardianProfileId),
            ),
          );
        return row?.at;
      });

    beforeAll(async () => {
      // B's own revoked link: a restore that reached it would show in the snapshot.
      await asAdmin((tx) =>
        tx
          .update(studentGuardianLinks)
          .set({ accessRevokedAt: new Date(), accessRevokedBy: instB.userId })
          .where(
            and(
              eq(studentGuardianLinks.studentProfileId, b.s1),
              eq(studentGuardianLinks.guardianProfileId, b.g2),
            ),
          ),
      );
    });

    it.each([
      ['studentProfileId', () => restore(b.s1, a.g2)],
      ['guardianProfileId', () => restore(a.s2, b.g2)],
      ['both ids', () => restore(b.s1, b.g2)],
    ] as const)('should refuse %s of another institute and change no link', async (_field, variables) => {
      await refusesAndWritesNothing(RESTORE_ACCESS, variables(), ErrorCode.GUARDIAN_LINK_NOT_FOUND);
    });

    it('should restore its own guardian on its own student', async () => {
      // Revoked by the block above.
      expect(await revokedAt(a.s2, a.g2)).toBeInstanceOf(Date);

      const res = await gqlRequest<{ restoreGuardianAccess: { accessRevokedAt: string | null } }>(
        result.httpServer,
        { query: RESTORE_ACCESS, variables: restore(a.s2, a.g2), token: tokenA },
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.restoreGuardianAccess.accessRevokedAt).toBeNull();
      expect(await revokedAt(a.s2, a.g2)).toBeNull();
      expect(await revokedAt(b.s1, b.g2)).toBeInstanceOf(Date);
    });
  });

  describe('unlinkGuardianFromStudent', () => {
    const unlink = (
      studentProfileId: string,
      guardianProfileId: string,
      newPrimaryGuardianId?: string,
    ) => ({ input: { studentProfileId, guardianProfileId, newPrimaryGuardianId } });

    it.each([
      ['studentProfileId', () => unlink(b.s1, a.g2), ErrorCode.GUARDIAN_LINK_NOT_FOUND],
      ['guardianProfileId', () => unlink(a.s1, b.g2), ErrorCode.GUARDIAN_LINK_NOT_FOUND],
      ['both ids', () => unlink(b.s1, b.g2), ErrorCode.GUARDIAN_LINK_NOT_FOUND],
      [
        'newPrimaryGuardianId',
        () => unlink(a.s1, a.g1, b.g2),
        ErrorCode.REPLACEMENT_PRIMARY_GUARDIAN_INVALID,
      ],
    ] as const)('should refuse %s of another institute and change no link', async (_field, variables, code) => {
      await refusesAndWritesNothing(UNLINK, variables(), code);
    });

    it('should unlink its own primary guardian and make its own other guardian primary', async () => {
      const res = await gqlRequest<{ unlinkGuardianFromStudent: boolean }>(result.httpServer, {
        query: UNLINK,
        variables: unlink(a.s1, a.g1, a.g2),
        token: tokenA,
      });

      expect(res.errors).toBeUndefined();
      expect(res.data?.unlinkGuardianFromStudent).toBe(true);
      const [removed] = await linkRow(a.s1, a.g1);
      expect(removed?.deleted).toBeInstanceOf(Date);
      expect(await linkRow(a.s1, a.g2)).toEqual([
        { tenantId: instA.tenantId, isPrimaryContact: true, canPickup: true, deleted: null },
      ]);
    });

    // Runs after the unlink above: that link is soft-deleted now.
    it('should refuse to revoke a link that was removed', async () => {
      await refusesAndWritesNothing(
        REVOKE,
        { input: { studentProfileId: a.s1, guardianProfileId: a.g1, reason: 'Removed link' } },
        ErrorCode.GUARDIAN_LINK_NOT_FOUND,
      );
    });
  });
});
