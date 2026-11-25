/**
 * ROV-349: a typed employee ID is saved and unique among an institute's current staff; a blank
 * one takes the next free value of the series; social category is saved.
 */
import { DefaultRoles, ErrorCode } from '@roviq/common-types';
import {
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  staffProfiles,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:staff-employee-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const CREATE = /* GraphQL */ `
  mutation ($input: CreateStaffInput!) {
    createStaffMember(input: $input) {
      id
      employeeId
      socialCategory
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation ($id: ID!) {
    deleteStaffMember(id: $id)
  }
`;
const RESTORE = /* GraphQL */ `
  mutation ($id: ID!) {
    restoreStaffMember(id: $id)
  }
`;

interface Institute {
  tenantId: string;
  token: string;
}
interface StaffNode {
  id: string;
  employeeId: string | null;
  socialCategory: string | null;
}

async function setUpInstitute(db: DrizzleDB): Promise<Institute> {
  const base = await createTestInstitute(db);
  await withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
    tx.insert(roles).values({
      name: { en: DefaultRoles.Teacher },
      scope: 'institute',
      tenantId: base.tenantId,
      abilities: [],
      isDefault: false,
      isSystem: false,
      ...BY,
    }),
  );
  const token = createInstituteToken({
    sub: base.userId,
    tenantId: base.tenantId,
    membershipId: base.membershipId,
    roleId: base.roleId,
  });
  return { tenantId: base.tenantId, token };
}

describe('staff employee ID and social category (ROV-349)', () => {
  let app: IntegrationAppResult;
  let a: Institute;
  let b: Institute;

  const create = (inst: Institute, input: Record<string, unknown>) =>
    gqlRequest<{ createStaffMember: StaffNode }>(app.httpServer, {
      query: CREATE,
      variables: { input: { firstName: { en: 'Kiran' }, ...input } },
      token: inst.token,
    });

  const membershipCount = async (tenantId: string) => {
    const [row] = await withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.select({ n: count() }).from(memberships).where(eq(memberships.tenantId, tenantId)),
    );
    return row.n;
  };

  const storedProfile = async (id: string) => {
    const [row] = await withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          employeeId: staffProfiles.employeeId,
          socialCategory: staffProfiles.socialCategory,
        })
        .from(staffProfiles)
        .where(eq(staffProfiles.id, id)),
    );
    return row;
  };

  beforeAll(async () => {
    app = await createIntegrationApp({ modules: [AppModule] });
    a = await setUpInstitute(app.db);
    b = await setUpInstitute(app.db);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('stores a typed employee ID and the social category', async () => {
    const res = await create(a, { employeeId: 'T-101', socialCategory: 'OBC' });
    expect(res.errors).toBeUndefined();
    const node = res.data?.createStaffMember;
    expect(node).toMatchObject({ employeeId: 'T-101', socialCategory: 'OBC' });
    expect(await storedProfile(node?.id ?? '')).toEqual({
      employeeId: 'T-101',
      socialCategory: 'OBC',
    });
  });

  it('refuses an ID a current staff member of the institute holds, and creates no account', async () => {
    const before = await membershipCount(a.tenantId);
    const res = await create(a, { employeeId: 'T-101' });
    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.EMPLOYEE_ID_DUPLICATE);
    expect(await membershipCount(a.tenantId)).toBe(before);
  });

  it('allows the same ID in another institute', async () => {
    const res = await create(b, { employeeId: 'T-101' });
    expect(res.errors).toBeUndefined();
    expect(res.data?.createStaffMember.employeeId).toBe('T-101');
  });

  it('generates the next free number when the ID is left blank, skipping a typed one', async () => {
    const typed = await create(a, { employeeId: 'EMP-0001' });
    expect(typed.errors).toBeUndefined();
    const generated = await create(a, {});
    expect(generated.errors).toBeUndefined();
    expect(generated.data?.createStaffMember.employeeId).toBe('EMP-0002');
    expect(generated.data?.createStaffMember.socialCategory).toBeNull();
  });

  it('refuses a blank-only ID', async () => {
    const res = await create(a, { employeeId: '   ' });
    expect(res.errors?.length).toBeGreaterThan(0);
  });

  it('frees a deleted staff member’s ID, and refuses to restore once it is reused', async () => {
    const first = await create(a, { employeeId: 'T-202' });
    const firstId = first.data?.createStaffMember.id ?? '';
    const del = await gqlRequest(app.httpServer, {
      query: DELETE,
      variables: { id: firstId },
      token: a.token,
    });
    expect(del.errors).toBeUndefined();

    const reuse = await create(a, { employeeId: 'T-202' });
    expect(reuse.errors).toBeUndefined();

    const restore = await gqlRequest(app.httpServer, {
      query: RESTORE,
      variables: { id: firstId },
      token: a.token,
    });
    expect(restore.errors?.[0]?.extensions?.code).toBe(ErrorCode.EMPLOYEE_ID_DUPLICATE);
    const [row] = await withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ deletedAt: staffProfiles.deletedAt })
        .from(staffProfiles)
        .where(eq(staffProfiles.id, firstId)),
    );
    expect(row.deletedAt).not.toBeNull();
  });
});
