/**
 * ROV-293: createGuardian refuses a student of another institute and writes nothing in either
 * institute.
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  DefaultRoles,
  ErrorCode,
  SocialCategory,
} from '@roviq/common-types';
import {
  type DrizzleDB,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentProfiles,
  tenantUserProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { foreignIdRequests } from '../../../__tests__/foreign-id-requests';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:guardian-create-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const CREATE_GUARDIAN = /* GraphQL */ `
  mutation CreateGuardian($input: CreateGuardianInput!) {
    createGuardian(input: $input) {
      id
    }
  }
`;

describe('createGuardian: a student of another institute (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let foreignStudentId: string;

  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [instB, foreignStudentId],
    specFile: __filename,
  });

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Everything a guardian create writes in an institute, and the users the caller created. */
  const writtenIn = (inst: TestInstitute) =>
    asAdmin(async (tx) => ({
      users: await tx.select({ id: users.id }).from(users).where(eq(users.createdBy, inst.userId)),
      memberships: await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.tenantId, inst.tenantId)),
      copies: await tx
        .select({ id: tenantUserProfiles.id })
        .from(tenantUserProfiles)
        .where(eq(tenantUserProfiles.tenantId, inst.tenantId)),
      guardians: await tx
        .select({ id: guardianProfiles.id })
        .from(guardianProfiles)
        .where(eq(guardianProfiles.tenantId, inst.tenantId)),
      links: await tx
        .select({ id: studentGuardianLinks.id })
        .from(studentGuardianLinks)
        .where(eq(studentGuardianLinks.tenantId, inst.tenantId)),
    }));

  const foreignStudent = () =>
    asAdmin(async (tx) => ({
      profile: await tx
        .select()
        .from(studentProfiles)
        .where(eq(studentProfiles.id, foreignStudentId)),
      links: await tx
        .select()
        .from(studentGuardianLinks)
        .where(eq(studentGuardianLinks.studentProfileId, foreignStudentId)),
    }));

  const addParentRole = (inst: TestInstitute) =>
    asAdmin((tx) =>
      tx.insert(roles).values({
        name: { en: DefaultRoles.Parent },
        scope: 'institute',
        tenantId: inst.tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        ...BY,
      }),
    );

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    await addParentRole(instA);
    await addParentRole(instB);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    foreignStudentId = await asAdmin(async (tx) => {
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
      const [membership] = await tx
        .insert(memberships)
        .values({
          userId: user.id,
          roleId: instB.roleId,
          tenantId: instB.tenantId,
          abilities: [],
          ...BY,
        })
        .returning({ id: memberships.id });
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId: instB.tenantId,
          userId: user.id,
          membershipId: membership.id,
          admissionNumber: `ADM-${suffix}`,
          admissionDate: '2026-04-01',
          admissionType: AdmissionType.NEW,
          academicStatus: AcademicStatus.ENROLLED,
          socialCategory: SocialCategory.GENERAL,
          ...BY,
        })
        .returning({ id: studentProfiles.id });
      return profile.id;
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should refuse a student of another institute and write nothing in either institute', async () => {
    const emit = vi.spyOn(EventBusService.prototype, 'emit');
    const ownBefore = await writtenIn(instA);
    const otherBefore = await writtenIn(instB);
    const foreignBefore = await foreignStudent();

    const res = await request<{ createGuardian: { id: string } }>({
      query: CREATE_GUARDIAN,
      variables: {
        input: {
          firstName: { en: 'Sunita' },
          lastName: { en: 'Rao' },
          studentProfileId: foreignStudentId,
          relationship: 'MOTHER',
        },
      },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.STUDENT_NOT_FOUND);
    expect(res.data).toBeNull();
    expect(await foreignStudent()).toEqual(foreignBefore);
    expect(await writtenIn(instB)).toEqual(otherBefore);
    expect(await writtenIn(instA)).toEqual(ownBefore);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  });

  it('should leave no link from a guardian of this institute to the other institute student', async () => {
    const links = await asAdmin((tx) =>
      tx
        .select({ id: studentGuardianLinks.id })
        .from(studentGuardianLinks)
        .where(
          or(
            eq(studentGuardianLinks.studentProfileId, foreignStudentId),
            eq(studentGuardianLinks.tenantId, instA.tenantId),
          ),
        ),
    );

    expect(links).toEqual([]);
  });
});
