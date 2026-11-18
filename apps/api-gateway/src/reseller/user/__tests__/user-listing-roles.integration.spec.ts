/**
 * The admin and reseller user listings return each membership's role name (ROV-101:
 * the Users tabs showed role ids). The reseller listing stays inside its own institutes.
 */
import { randomUUID } from 'node:crypto';
import { mkAdminCtx, roles, withAdmin } from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  cleanupTestTeacher,
  createIntegrationApp,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
  type TestTeacher,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const ADMIN_USERS = `
  query($tenantId: String!) {
    adminListUsers(filter: { tenantId: $tenantId, first: 50 }) {
      edges { node { id memberships { tenantId roleId roleName } } }
    }
  }
`;
const RESELLER_USERS = `
  query($instituteId: String!) {
    resellerListUsers(filter: { instituteId: $instituteId, first: 50 }) {
      edges { node { id memberships { tenantId roleId roleName } } }
    }
  }
`;

interface MembershipRow {
  tenantId: string;
  roleId: string;
  roleName: Record<string, string>;
}
interface UserRow {
  id: string;
  memberships: MembershipRow[];
}

describe('User listings return role names (integration)', () => {
  let result: IntegrationAppResult;
  let owner: TestReseller;
  let otherReseller: TestReseller;
  let institute: TestInstitute;
  let teacher: TestTeacher;
  let teacherRoleName: Record<string, string>;

  const platformToken = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });
  const resellerToken = (reseller: TestReseller) =>
    createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });
  const teacherMembership = (users: UserRow[] | undefined) =>
    users
      ?.find((user) => user.id === teacher.userId)
      ?.memberships.find((m) => m.tenantId === institute.tenantId);

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    owner = await createTestReseller(result.db);
    otherReseller = await createTestReseller(result.db);
    institute = await createTestInstitute(result.db, { resellerId: owner.resellerId });
    teacher = await createTestTeacher(result.db, institute.tenantId);
    const [role] = await withAdmin(result.db, mkAdminCtx('test:user-listing-roles'), (tx) =>
      tx.select({ name: roles.name }).from(roles).where(eq(roles.id, teacher.roleId)),
    );
    teacherRoleName = role.name;
  });

  afterAll(async () => {
    if (teacher) await cleanupTestTeacher(result.db, teacher);
    if (institute) await cleanupTestInstitute(result.db, institute);
    if (otherReseller) await cleanupTestReseller(result.db, otherReseller);
    if (owner) await cleanupTestReseller(result.db, owner);
    await result?.close();
  });

  it('gives the platform admin each membership’s role name in every language', async () => {
    const response = await gqlRequest(result.httpServer, {
      query: ADMIN_USERS,
      variables: { tenantId: institute.tenantId },
      token: platformToken,
    });

    expect(response.errors).toBeUndefined();
    const users: UserRow[] = response.data?.adminListUsers.edges.map(
      (edge: { node: UserRow }) => edge.node,
    );
    expect(teacherMembership(users)).toEqual({
      tenantId: institute.tenantId,
      roleId: teacher.roleId,
      roleName: teacherRoleName,
    });
  });

  it('gives the owning reseller the same role name', async () => {
    const response = await gqlRequest(result.httpServer, {
      query: RESELLER_USERS,
      variables: { instituteId: institute.tenantId },
      token: resellerToken(owner),
    });

    expect(response.errors).toBeUndefined();
    const users: UserRow[] = response.data?.resellerListUsers.edges.map(
      (edge: { node: UserRow }) => edge.node,
    );
    expect(teacherMembership(users)?.roleName).toEqual(teacherRoleName);
  });

  it('shows another reseller nobody from this institute', async () => {
    const response = await gqlRequest(result.httpServer, {
      query: RESELLER_USERS,
      variables: { instituteId: institute.tenantId },
      token: resellerToken(otherReseller),
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.resellerListUsers.edges).toEqual([]);
  });
});
