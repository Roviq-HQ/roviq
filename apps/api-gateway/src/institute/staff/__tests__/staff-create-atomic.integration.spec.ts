/**
 * ROV-362: adding a staff member is one unit of work. A refused create leaves no account,
 * membership or profile behind, a blank employee ID never answers EMPLOYEE_ID_DUPLICATE, and a
 * missing Teacher role is refused before anything is written.
 */
import { randomUUID } from 'node:crypto';
import { DefaultRoles, ErrorCode } from '@roviq/common-types';
import {
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  staffProfiles,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:staff-create-atomic';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const CREATE = /* GraphQL */ `
  mutation ($input: CreateStaffInput!) {
    createStaffMember(input: $input) {
      id
      employeeId
    }
  }
`;

interface Institute {
  tenantId: string;
  adminUserId: string;
  token: string;
}

describe('createStaffMember: one unit of work (ROV-362)', () => {
  let app: IntegrationAppResult;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(app.db, mkAdminCtx(ORIGIN), fn);

  async function setUpInstitute(withTeacherRole: boolean): Promise<Institute> {
    const base = await createTestInstitute(app.db);
    if (withTeacherRole) {
      await asAdmin((tx) =>
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
    }
    const token = createInstituteToken({
      sub: base.userId,
      tenantId: base.tenantId,
      membershipId: base.membershipId,
      roleId: base.roleId,
    });
    return { tenantId: base.tenantId, adminUserId: base.userId, token };
  }

  const create = (inst: Institute, input: Record<string, unknown>) =>
    gqlRequest<{ createStaffMember: { id: string; employeeId: string } }>(app.httpServer, {
      query: CREATE,
      variables: { input: { firstName: { en: 'Kiran' }, ...input } },
      token: inst.token,
    });

  /** Every row a staff create writes, for this institute and the accounts its admin made. */
  const written = (inst: Institute) =>
    asAdmin(async (tx) => {
      const made = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.createdBy, inst.adminUserId));
      const ids = made.map((u) => u.id);
      return {
        users: made.map((u) => u.email).sort(),
        accountProfiles:
          ids.length === 0
            ? []
            : await tx
                .select({ id: userProfiles.id })
                .from(userProfiles)
                .where(inArray(userProfiles.userId, ids)),
        memberships: await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, inst.tenantId),
              sql`${memberships.userId} <> ${inst.adminUserId}`,
            ),
          ),
        copies: await tx
          .select({ id: tenantUserProfiles.id })
          .from(tenantUserProfiles)
          .where(
            and(
              eq(tenantUserProfiles.tenantId, inst.tenantId),
              sql`${tenantUserProfiles.userId} <> ${inst.adminUserId}`,
            ),
          ),
        staff: await tx
          .select({ employeeId: staffProfiles.employeeId })
          .from(staffProfiles)
          .where(eq(staffProfiles.tenantId, inst.tenantId)),
      };
    });

  /**
   * Gives an existing staff member `employeeId` in a transaction left open until the create
   * waits on it, then commits: the create passed its early check and loses at the insert.
   */
  async function raceAgainstHeldId<T>(
    staffProfileId: string,
    employeeId: string,
    request: () => Promise<T>,
  ): Promise<T> {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markHeld = () => {};
    const isHeld = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    const holder = asAdmin(async (tx) => {
      await tx
        .update(staffProfiles)
        .set({ employeeId })
        .where(eq(staffProfiles.id, staffProfileId));
      markHeld();
      await released;
    });
    await isHeld;

    const pending = request();
    await waitForLockWait();
    release();
    await holder;
    return pending;
  }

  /** Until some backend waits on a row or transaction lock (the create's insert). */
  async function waitForLockWait(): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const waiting = await asAdmin((tx) =>
        tx.execute(
          sql`SELECT count(*) AS n FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'`,
        ),
      );
      if (Number((waiting.rows[0] as { n: string }).n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('The create never waited on the held employee ID');
  }

  beforeAll(async () => {
    app = await createIntegrationApp({ modules: [AppModule] });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('should refuse a typed ID that loses the race, leave nothing, and accept a retry with another ID', async () => {
    const inst = await setUpInstitute(true);
    const holder = await create(inst, { employeeId: 'HOLD-1' });
    expect(holder.errors).toBeUndefined();
    const before = await written(inst);
    const email = `race_${randomUUID().slice(0, 8)}@test.local`;

    const lost = await raceAgainstHeldId(holder.data?.createStaffMember.id ?? '', 'T-RACE', () =>
      create(inst, { email, employeeId: 'T-RACE' }),
    );

    expect(lost.errors?.[0]?.extensions?.code).toBe(ErrorCode.EMPLOYEE_ID_DUPLICATE);
    const after = await written(inst);
    expect(after).toEqual({
      ...before,
      staff: [{ employeeId: 'T-RACE' }],
    });

    const retry = await create(inst, { email, employeeId: 'T-RETRY' });
    expect(retry.errors).toBeUndefined();
    expect(retry.data?.createStaffMember.employeeId).toBe('T-RETRY');
    expect((await written(inst)).users).toEqual([...before.users, email].sort());
  });

  it('should give a blank-ID create the following series value when a typed ID takes the next one', async () => {
    const inst = await setUpInstitute(true);
    const first = await create(inst, {});
    expect(first.data?.createStaffMember.employeeId).toBe('EMP-0001');
    const holder = await create(inst, { employeeId: 'HOLD-2' });
    expect(holder.errors).toBeUndefined();

    const blank = await raceAgainstHeldId(holder.data?.createStaffMember.id ?? '', 'EMP-0002', () =>
      create(inst, {}),
    );

    expect(blank.errors).toBeUndefined();
    expect(blank.data?.createStaffMember.employeeId).toBe('EMP-0003');
  });

  it('should refuse a create when the institute has no Teacher role, writing nothing', async () => {
    const inst = await setUpInstitute(false);
    const before = await written(inst);
    const email = `norole_${randomUUID().slice(0, 8)}@test.local`;

    const res = await create(inst, { email, phone: '9876501234' });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.ROLE_NOT_FOUND);
    expect(await written(inst)).toEqual(before);
    const accounts = await asAdmin((tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.email, email)),
    );
    expect(accounts).toEqual([]);
  });
});
