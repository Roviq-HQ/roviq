/**
 * ROV-358: a guardian write that repeats a value the database keeps unique answers its own
 * code, not INTERNAL_ERROR, and stores nothing.
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
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentProfiles,
  users,
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
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:guardian-duplicates';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const CREATE_GUARDIAN = /* GraphQL */ `
  mutation CreateGuardian($input: CreateGuardianInput!) {
    createGuardian(input: $input) {
      id
    }
  }
`;
const LINK = /* GraphQL */ `
  mutation LinkGuardian($input: LinkGuardianInput!) {
    linkGuardianToStudent(input: $input) {
      id
    }
  }
`;

describe('guardian writes that repeat a unique value (ROV-358)', () => {
  let result: IntegrationAppResult;
  let inst: TestInstitute;
  let token: string;
  let studentId: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const createGuardian = (input: Record<string, unknown>) =>
    gqlRequest<{ createGuardian: { id: string } }>(result.httpServer, {
      query: CREATE_GUARDIAN,
      variables: { input: { firstName: { en: 'Sunita' }, ...input } },
      token,
    });

  const linkCount = async () => {
    const [row] = await asAdmin((tx) =>
      tx
        .select({ n: count() })
        .from(studentGuardianLinks)
        .where(eq(studentGuardianLinks.studentProfileId, studentId)),
    );
    return row.n;
  };

  const membershipCount = async () => {
    const [row] = await asAdmin((tx) =>
      tx.select({ n: count() }).from(memberships).where(eq(memberships.tenantId, inst.tenantId)),
    );
    return row.n;
  };

  const usersWithEmail = async (email: string) => {
    const [row] = await asAdmin((tx) =>
      tx.select({ n: count() }).from(users).where(eq(users.email, email)),
    );
    return row.n;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    inst = await createTestInstitute(result.db);
    token = createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });
    studentId = await asAdmin(async (tx) => {
      await tx.insert(roles).values({
        name: { en: DefaultRoles.Parent },
        scope: 'institute',
        tenantId: inst.tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        ...BY,
      });
      const suffix = randomUUID().slice(0, 8);
      const [user] = await tx
        .insert(users)
        .values({
          email: `guardian_dup_${suffix}@test.local`,
          username: `guardian_dup_${suffix}`,
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
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId: inst.tenantId,
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

  it('refuses a second link of the same guardian to the same student', async () => {
    const created = await createGuardian({ studentProfileId: studentId, relationship: 'MOTHER' });
    expect(created.errors).toBeUndefined();
    const guardianProfileId = created.data?.createGuardian.id ?? '';
    expect(await linkCount()).toBe(1);

    const res = await gqlRequest(result.httpServer, {
      query: LINK,
      variables: {
        input: { guardianProfileId, studentProfileId: studentId, relationship: 'MOTHER' },
      },
      token,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.GUARDIAN_ALREADY_LINKED);
    expect(await linkCount()).toBe(1);
  });

  it('refuses an email that is already an account email, and creates no account', async () => {
    const email = `parent_${randomUUID().slice(0, 8)}@test.local`;
    const first = await createGuardian({ email });
    expect(first.errors).toBeUndefined();
    const before = await membershipCount();

    const res = await createGuardian({ email, firstName: { en: 'Anita' } });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.EMAIL_TAKEN);
    expect(await membershipCount()).toBe(before);
    expect(await usersWithEmail(email)).toBe(1);
  });
});
