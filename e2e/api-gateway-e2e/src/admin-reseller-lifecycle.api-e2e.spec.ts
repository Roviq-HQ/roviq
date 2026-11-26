/**
 * Admin reseller lifecycle E2E (ROV-97).
 *
 * Covers the full suspend → unsuspend → delete state machine against a
 * throwaway test reseller created via superuser DB access. The system reseller
 * "Roviq Direct" rejection cases are already covered in
 * security-invariants.api-e2e.spec.ts (#18); this file exercises the happy
 * path + state guards.
 */
import assert from 'node:assert';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import {
  E2eAdminChangeResellerTierDocument,
  E2eAdminCreateResellerDocument,
  E2eAdminDeleteResellerDocument,
  E2eAdminGetResellerDocument,
  E2eAdminListResellersDocument,
  E2eAdminListResellerTeamDocument,
  E2eAdminResellerAuditLogsDocument,
  E2eAdminSuspendResellerDocument,
  E2eAdminUnsuspendResellerDocument,
  E2eAdminUpdateResellerDocument,
} from './__generated__/graphql';
import { loginAsPlatformAdmin } from './helpers/auth';
import { gql } from './helpers/gql-client';

async function currentVersion(token: string, id: string): Promise<number> {
  const res = await gql(E2eAdminGetResellerDocument, { id }, token);
  expect(res.errors).toBeUndefined();
  assert(res.data);
  return res.data.adminGetReseller.version;
}

// Superuser URL required — RLS would otherwise block writes to the
// resellers table under the pooler role. Matches the pattern in
// audit.api-e2e.spec.ts but uses the `roviq` superuser.
const SUPERUSER_URL =
  process.env.DATABASE_URL_E2E_MIGRATE ??
  process.env.DATABASE_URL_TEST_MIGRATE ??
  `postgresql://roviq:roviq_dev@localhost:${process.env.E2E_POSTGRES_PORT ?? '5435'}/roviq_test`;

// Fixed test UUIDs so re-runs are idempotent (we DELETE by ID in afterAll).
const TEST_RESELLER_ID = 'ffffffff-f000-4000-a000-000000000101';
const TEST_RESELLER_ID_FOR_DELETE = 'ffffffff-f000-4000-a000-000000000102';

async function insertTestReseller(
  pool: pg.Pool,
  id: string,
  slug: string,
  opts: { suspendedDaysAgo?: number } = {},
): Promise<void> {
  const status = opts.suspendedDaysAgo !== undefined ? 'SUSPENDED' : 'ACTIVE';
  const suspendedAt =
    opts.suspendedDaysAgo !== undefined
      ? new Date(Date.now() - opts.suspendedDaysAgo * 24 * 60 * 60 * 1000)
      : null;

  await pool.query(
    `INSERT INTO resellers (id, name, slug, tier, is_system, is_active, status, suspended_at, created_by, updated_by)
     VALUES ($1, $2, $3, 'FULL_MANAGEMENT', false, $4, $5, $6, '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')
     ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           is_active = EXCLUDED.is_active,
           suspended_at = EXCLUDED.suspended_at,
           deleted_at = NULL`,
    [id, `Test Reseller ${id.slice(-4)}`, slug, status === 'ACTIVE', status, suspendedAt],
  );
}

// A plan and a gateway config of the reseller to delete: the billing cleanup deactivates both.
const TEST_PLAN_ID = 'ffffffff-f000-4000-a000-000000000201';
const TEST_GATEWAY_CONFIG_ID = 'ffffffff-f000-4000-a000-000000000202';
// CANCELLED, so it never clashes with the seeded institute's own active subscription.
const TEST_SUBSCRIPTION_ID = 'ffffffff-f000-4000-a000-000000000203';
const ROVIQ_DIRECT_ID = '00000000-0000-7000-a000-000000000011';

async function insertBillingRows(pool: pg.Pool, resellerId: string): Promise<void> {
  await pool.query(
    `INSERT INTO plans (id, reseller_id, name, code, interval, amount, status, created_by, updated_by)
     VALUES ($1, $2, '{"en":"Cleanup plan"}', 'e2e-cleanup', 'MONTHLY', 99900, 'ACTIVE',
             '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')
     ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', deleted_at = NULL`,
    [TEST_PLAN_ID, resellerId],
  );
  await pool.query(
    `INSERT INTO payment_gateway_configs (id, reseller_id, provider, display_name, status, created_by, updated_by)
     VALUES ($1, $2, 'RAZORPAY', 'Razorpay', 'ACTIVE',
             '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')
     ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', deleted_at = NULL`,
    [TEST_GATEWAY_CONFIG_ID, resellerId],
  );
  await pool.query(
    `INSERT INTO subscriptions (id, tenant_id, plan_id, reseller_id, status, cancelled_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 'CANCELLED', now(),
             '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')
     ON CONFLICT (id) DO UPDATE SET reseller_id = EXCLUDED.reseller_id`,
    [TEST_SUBSCRIPTION_ID, SEED.INSTITUTE_2.id, TEST_PLAN_ID, resellerId],
  );
}

async function billingStatuses(pool: pg.Pool): Promise<{
  plan: string | undefined;
  config: string | undefined;
  subscriptionReseller: string | undefined;
}> {
  const plan = await pool.query<{ status: string }>('SELECT status FROM plans WHERE id = $1', [
    TEST_PLAN_ID,
  ]);
  const config = await pool.query<{ status: string }>(
    'SELECT status FROM payment_gateway_configs WHERE id = $1',
    [TEST_GATEWAY_CONFIG_ID],
  );
  const subscription = await pool.query<{ reseller_id: string }>(
    'SELECT reseller_id FROM subscriptions WHERE id = $1',
    [TEST_SUBSCRIPTION_ID],
  );
  return {
    plan: plan.rows[0]?.status,
    config: config.rows[0]?.status,
    subscriptionReseller: subscription.rows[0]?.reseller_id,
  };
}

async function deleteTestReseller(pool: pg.Pool, id: string): Promise<void> {
  // Remove any dependent rows first — test reseller should have none, but defensive.
  await pool.query(
    'DELETE FROM subscriptions WHERE plan_id IN (SELECT id FROM plans WHERE reseller_id = $1)',
    [id],
  );
  await pool.query('DELETE FROM plans WHERE reseller_id = $1', [id]);
  await pool.query('DELETE FROM payment_gateway_configs WHERE reseller_id = $1', [id]);
  await pool.query('DELETE FROM reseller_memberships WHERE reseller_id = $1', [id]);
  await pool.query('DELETE FROM roles WHERE reseller_id = $1', [id]);
  await pool.query('DELETE FROM resellers WHERE id = $1', [id]);
}

async function getResellerRoles(
  pool: pg.Pool,
  resellerId: string,
): Promise<{ id: string; name: string }[]> {
  const res = await pool.query<{ id: string; name: string }>(
    `SELECT id, name->>'en' AS name FROM roles
     WHERE reseller_id = $1 AND scope = 'reseller' AND deleted_at IS NULL
     ORDER BY name->>'en'`,
    [resellerId],
  );
  return res.rows;
}

async function getResellerStatus(
  pool: pg.Pool,
  id: string,
): Promise<{
  status: string;
  isActive: boolean;
  suspendedAt: Date | null;
  deletedAt: Date | null;
}> {
  const res = await pool.query<{
    status: string;
    is_active: boolean;
    suspended_at: Date | null;
    deleted_at: Date | null;
  }>('SELECT status, is_active, suspended_at, deleted_at FROM resellers WHERE id = $1', [id]);
  const row = res.rows[0];
  assert(row, `reseller ${id} not found`);
  return {
    status: row.status,
    isActive: row.is_active,
    suspendedAt: row.suspended_at,
    deletedAt: row.deleted_at,
  };
}

describe('Admin Reseller Lifecycle E2E (ROV-97)', () => {
  let pool: pg.Pool;
  let adminToken: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: SUPERUSER_URL, max: 3 });
    const admin = await loginAsPlatformAdmin();
    adminToken = admin.accessToken;

    await insertTestReseller(pool, TEST_RESELLER_ID, `test-reseller-${TEST_RESELLER_ID.slice(-4)}`);
    await insertTestReseller(
      pool,
      TEST_RESELLER_ID_FOR_DELETE,
      `test-reseller-${TEST_RESELLER_ID_FOR_DELETE.slice(-4)}`,
      { suspendedDaysAgo: 40 },
    );
    await insertBillingRows(pool, TEST_RESELLER_ID_FOR_DELETE);
  });

  afterAll(async () => {
    await deleteTestReseller(pool, TEST_RESELLER_ID);
    await deleteTestReseller(pool, TEST_RESELLER_ID_FOR_DELETE);
    await pool.end();
  });

  // ── suspendReseller ─────────────────────────────────────────

  it('suspends an active reseller', async () => {
    const res = await gql(
      E2eAdminSuspendResellerDocument,
      { id: TEST_RESELLER_ID, reason: 'e2e lifecycle test' },
      adminToken,
    );

    expect(res.errors).toBeUndefined();
    assert(res.data);
    expect(res.data.adminSuspendReseller).toMatchObject({
      id: TEST_RESELLER_ID,
      status: 'SUSPENDED',
    });
    expect(res.data.adminSuspendReseller.suspendedAt).not.toBeNull();

    const after = await getResellerStatus(pool, TEST_RESELLER_ID);
    expect(after.status).toBe('SUSPENDED');
    expect(after.isActive).toBe(false);
    expect(after.suspendedAt).not.toBeNull();
  });

  it('rejects suspending an already-suspended reseller', async () => {
    const res = await gql(E2eAdminSuspendResellerDocument, { id: TEST_RESELLER_ID }, adminToken);

    expect(res.errors).toBeDefined();
    assert(res.errors);
    expect(res.errors[0].message).toMatch(/already suspended/i);
  });

  it('rejects suspending an unknown reseller', async () => {
    const res = await gql(
      E2eAdminSuspendResellerDocument,
      { id: '00000000-0000-7000-a000-00000000dead' },
      adminToken,
    );

    expect(res.errors).toBeDefined();
    assert(res.errors);
    expect(res.errors[0].message).toMatch(/not found/i);
  });

  // ── unsuspendReseller ───────────────────────────────────────

  it('unsuspends a suspended reseller', async () => {
    const res = await gql(E2eAdminUnsuspendResellerDocument, { id: TEST_RESELLER_ID }, adminToken);

    expect(res.errors).toBeUndefined();
    assert(res.data);
    expect(res.data.adminUnsuspendReseller).toEqual({
      id: TEST_RESELLER_ID,
      status: 'ACTIVE',
      suspendedAt: null,
    });

    const after = await getResellerStatus(pool, TEST_RESELLER_ID);
    expect(after.status).toBe('ACTIVE');
    expect(after.isActive).toBe(true);
    expect(after.suspendedAt).toBeNull();
  });

  it('rejects unsuspending an active reseller', async () => {
    const res = await gql(E2eAdminUnsuspendResellerDocument, { id: TEST_RESELLER_ID }, adminToken);

    expect(res.errors).toBeDefined();
    assert(res.errors);
    expect(res.errors[0].message).toMatch(/not suspended/i);
  });

  it('rejects unsuspending the system reseller', async () => {
    const res = await gql(
      E2eAdminUnsuspendResellerDocument,
      { id: '00000000-0000-7000-a000-000000000011' },
      adminToken,
    );

    expect(res.errors).toBeDefined();
    assert(res.errors);
    expect(res.errors[0].message).toMatch(/system reseller|forbidden/i);
  });

  // ── deleteReseller — grace period ──────────────────────────

  it('rejects deleting a reseller that was suspended less than 30 days ago', async () => {
    // Reseller 1 was just unsuspended above — re-suspend it now (suspendedAt = now)
    await gql(E2eAdminSuspendResellerDocument, { id: TEST_RESELLER_ID }, adminToken);

    const res = await gql(E2eAdminDeleteResellerDocument, { id: TEST_RESELLER_ID }, adminToken);

    expect(res.errors).toBeDefined();
    assert(res.errors);
    expect(res.errors[0].message).toMatch(/grace period/i);
  });

  it('rejects deleting an active (non-suspended) reseller', async () => {
    // Flip back to active
    await gql(E2eAdminUnsuspendResellerDocument, { id: TEST_RESELLER_ID }, adminToken);

    const res = await gql(E2eAdminDeleteResellerDocument, { id: TEST_RESELLER_ID }, adminToken);

    expect(res.errors).toBeDefined();
    assert(res.errors);
    expect(res.errors[0].message).toMatch(/must be suspended/i);
  });

  // ── deleteReseller — happy path (pre-aged reseller) ────────

  it('deletes a reseller that has been suspended for 30+ days', async () => {
    const res = await gql(
      E2eAdminDeleteResellerDocument,
      { id: TEST_RESELLER_ID_FOR_DELETE },
      adminToken,
    );

    expect(res.errors).toBeUndefined();
    assert(res.data);
    expect(res.data.adminDeleteReseller).toMatchObject({
      id: TEST_RESELLER_ID_FOR_DELETE,
      status: 'DELETED',
    });
    expect(res.data.adminDeleteReseller.deletedAt).not.toBeNull();

    const after = await getResellerStatus(pool, TEST_RESELLER_ID_FOR_DELETE);
    expect(after.status).toBe('DELETED');
    expect(after.deletedAt).not.toBeNull();
  });

  it('runs the billing cleanup of the deleted reseller: billing moves to Roviq Direct', async () => {
    // RESELLER.status_changed → ResellerDeletionConsumer → the billing worker's workflow.
    await expect
      .poll(() => billingStatuses(pool), { timeout: 30_000, interval: 500 })
      .toEqual({ plan: 'INACTIVE', config: 'INACTIVE', subscriptionReseller: ROVIQ_DIRECT_ID });
  });

  // ── ROV-234: adminListResellers ─────────────────────────────

  describe('adminListResellers (ROV-234)', () => {
    it('returns at least the system reseller + the active test reseller', async () => {
      // Make sure the first test reseller is active for this assertion
      await pool.query(
        `UPDATE resellers SET status='ACTIVE', is_active=true, suspended_at=NULL, deleted_at=NULL WHERE id=$1`,
        [TEST_RESELLER_ID],
      );

      const res = await gql(E2eAdminListResellersDocument, { filter: { first: 50 } }, adminToken);

      expect(res.errors).toBeUndefined();
      assert(res.data);
      const ids = res.data.adminListResellers.edges.map((e) => e.node.id);
      expect(ids).toContain('00000000-0000-7000-a000-000000000011'); // Roviq Direct
      expect(ids).toContain(TEST_RESELLER_ID);
      expect(res.data.adminListResellers.totalCount).toBeGreaterThanOrEqual(2);
    });

    it('filters by status (only SUSPENDED)', async () => {
      // Re-suspend the test reseller so this filter has a match
      await gql(
        E2eAdminSuspendResellerDocument,
        { id: TEST_RESELLER_ID, reason: 'filter test' },
        adminToken,
      );

      const res = await gql(
        E2eAdminListResellersDocument,
        { filter: { status: ['SUSPENDED'] } },
        adminToken,
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      for (const edge of res.data.adminListResellers.edges) {
        expect(edge.node.status).toBe('SUSPENDED');
      }
    });

    it('walks every page once with first=1 (cursor carries created_at and id)', async () => {
      const all = await gql(E2eAdminListResellersDocument, { filter: { first: 100 } }, adminToken);
      expect(all.errors).toBeUndefined();
      assert(all.data);
      const expected = all.data.adminListResellers.edges.map((e) => e.node.id);

      const walked: string[] = [];
      let after: string | null | undefined;
      for (let page = 0; page <= expected.length; page++) {
        const res = await gql(
          E2eAdminListResellersDocument,
          { filter: { first: 1, ...(after ? { after } : {}) } },
          adminToken,
        );
        expect(res.errors).toBeUndefined();
        assert(res.data);
        walked.push(...res.data.adminListResellers.edges.map((e) => e.node.id));
        if (!res.data.adminListResellers.pageInfo.hasNextPage) break;
        after = res.data.adminListResellers.pageInfo.endCursor;
      }
      expect(walked).toEqual(expected);
    });

    it('rejects a malformed cursor with VALIDATION_FAILED', async () => {
      const res = await gql(
        E2eAdminListResellersDocument,
        { filter: { after: 'not-a-cursor' } },
        adminToken,
      );
      assert(res.errors);
      expect(res.errors[0].extensions?.code).toBe('VALIDATION_FAILED');
    });

    it('filters by isSystem=true to isolate Roviq Direct', async () => {
      const res = await gql(
        E2eAdminListResellersDocument,
        { filter: { isSystem: true } },
        adminToken,
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.adminListResellers.edges.length).toBe(1);
      expect(res.data.adminListResellers.edges[0].node.isSystem).toBe(true);
    });
  });

  // ── ROV-234: adminGetReseller ───────────────────────────────

  describe('adminGetReseller (ROV-234)', () => {
    it('returns the reseller with computed counts', async () => {
      const res = await gql(
        E2eAdminGetResellerDocument,
        { id: '00000000-0000-7000-a000-000000000011' },
        adminToken,
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.adminGetReseller.slug).toBe('roviq-direct');
      // Seed plants 2 institutes under Roviq Direct
      expect(res.data.adminGetReseller.instituteCount).toBeGreaterThanOrEqual(2);
    });

    it('returns RESELLER_INVALID for unknown id', async () => {
      const res = await gql(
        E2eAdminGetResellerDocument,
        { id: '00000000-0000-7000-a000-00000000dead' },
        adminToken,
      );
      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].extensions).toMatchObject({ code: expect.anything() });
    });
  });

  // ── ROV-234: adminCreateReseller / adminUpdateReseller / adminChangeResellerTier

  describe('adminCreateReseller (ROV-234)', () => {
    // Per-run unique slug so re-runs don't collide with each other
    const createdSlug = `e2e-acme-${Date.now().toString(36)}`;
    let createdId: string | null = null;

    afterAll(async () => {
      if (createdId) await deleteTestReseller(pool, createdId);
    });

    it('creates a reseller + initial admin, returns the new row with tier=FULL_MANAGEMENT', async () => {
      const res = await gql(
        E2eAdminCreateResellerDocument,
        {
          input: {
            name: `E2E Acme ${Date.now().toString(36)}`,
            slug: createdSlug,
            tier: 'FULL_MANAGEMENT',
            initialAdminEmail: `e2e-admin-${Date.now().toString(36)}@roviq.test`,
            branding: { primaryColor: '#1677FF' },
          },
        },
        adminToken,
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.adminCreateReseller.slug).toBe(createdSlug);
      expect(res.data.adminCreateReseller.tier).toBe('FULL_MANAGEMENT');
      expect(res.data.adminCreateReseller.status).toBe('ACTIVE');
      expect(res.data.adminCreateReseller.isSystem).toBe(false);
      expect(res.data.adminCreateReseller.teamSize).toBe(1);
      createdId = res.data.adminCreateReseller.id;
    });

    it('lists the initial admin on the team with the full-admin role', async () => {
      assert(createdId);
      const res = await gql(
        E2eAdminListResellerTeamDocument,
        { resellerId: createdId },
        adminToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.adminListResellerTeam).toHaveLength(1);
      expect(res.data.adminListResellerTeam[0]).toMatchObject({
        roleName: { en: 'reseller_full_admin' },
        isActive: true,
        lastActiveAt: null,
      });
    });

    it('records the create in the audit trail, found through the resellerId filter', async () => {
      assert(createdId);
      const deadline = Date.now() + 10_000;
      let actions: string[] = [];
      while (Date.now() < deadline) {
        const res = await gql(
          E2eAdminResellerAuditLogsDocument,
          { filter: { resellerId: createdId } },
          adminToken,
        );
        expect(res.errors).toBeUndefined();
        actions = res.data?.adminAuditLogs.edges.map((e) => e.node.action) ?? [];
        if (actions.includes('adminCreateReseller')) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(actions).toContain('adminCreateReseller');
    });

    it('gives the new reseller its own system roles and puts the initial admin on its full-admin copy', async () => {
      assert(createdId);
      const ownRoles = await getResellerRoles(pool, createdId);
      expect(ownRoles.map((r) => r.name)).toEqual([
        'reseller_full_admin',
        'reseller_support_admin',
        'reseller_viewer',
      ]);

      const memberships = await pool.query<{ role_id: string }>(
        'SELECT role_id FROM reseller_memberships WHERE reseller_id = $1',
        [createdId],
      );
      const fullAdmin = ownRoles.find((r) => r.name === 'reseller_full_admin');
      assert(fullAdmin);
      expect(memberships.rows).toEqual([{ role_id: fullAdmin.id }]);
    });

    it('rejects a duplicate slug with SLUG_DUPLICATE', async () => {
      const res = await gql(
        E2eAdminCreateResellerDocument,
        {
          input: {
            name: 'Dup Slug Attempt',
            slug: createdSlug,
            tier: 'READ_ONLY',
            initialAdminEmail: `e2e-dup-${Date.now().toString(36)}@roviq.test`,
          },
        },
        adminToken,
      );

      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].message).toMatch(/already taken/i);
    });
  });

  describe('adminUpdateReseller (ROV-234)', () => {
    it('rejects updating the system reseller', async () => {
      const res = await gql(
        E2eAdminUpdateResellerDocument,
        {
          id: '00000000-0000-7000-a000-000000000011',
          input: { version: 1, name: 'Tampered' },
        },
        adminToken,
      );
      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].message).toMatch(/cannot be modified/i);
    });

    it('updates name + branding on an active reseller', async () => {
      // Unsuspend first in case earlier tests left it suspended
      await pool.query(
        `UPDATE resellers SET status='ACTIVE', is_active=true, suspended_at=NULL WHERE id=$1`,
        [TEST_RESELLER_ID],
      );

      const version = await currentVersion(adminToken, TEST_RESELLER_ID);
      const res = await gql(
        E2eAdminUpdateResellerDocument,
        {
          id: TEST_RESELLER_ID,
          input: {
            version,
            name: 'Renamed Test Reseller',
            branding: { primaryColor: '#FF4500' },
            registrationNumber: 'U72900RJ2024PTC012345',
            registrationState: 'RAJASTHAN',
            address: {
              line1: '12 MI Road',
              city: 'Jaipur',
              district: 'Jaipur',
              state: 'Rajasthan',
              postalCode: '302001',
              country: 'India',
            },
          },
        },
        adminToken,
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.adminUpdateReseller).toEqual({
        id: TEST_RESELLER_ID,
        name: 'Renamed Test Reseller',
        version: version + 1,
        registrationNumber: 'U72900RJ2024PTC012345',
        registrationState: 'RAJASTHAN',
        instituteCount: 0,
        teamSize: 0,
        address: { city: 'Jaipur', state: 'Rajasthan' },
        branding: { primaryColor: '#FF4500' },
      });
    });

    it('rejects a stale version with CONCURRENT_MODIFICATION', async () => {
      const version = await currentVersion(adminToken, TEST_RESELLER_ID);
      const res = await gql(
        E2eAdminUpdateResellerDocument,
        { id: TEST_RESELLER_ID, input: { version: version - 1, name: 'Stale Write' } },
        adminToken,
      );
      assert(res.errors);
      expect(res.errors[0].extensions?.code).toBe('CONCURRENT_MODIFICATION');
    });
  });

  // ── ROV-234: adminCreateReseller — initial admin email already registered ──

  describe('adminCreateReseller — existing admin email (ROV-234)', () => {
    const suffix = Date.now().toString(36);
    const sharedEmail = `e2e-shared-${suffix}@roviq.test`;
    const deletedEmail = `e2e-deleted-${suffix}@roviq.test`;
    const createdIds: string[] = [];

    afterAll(async () => {
      for (const id of createdIds) await deleteTestReseller(pool, id);
      await pool.query('DELETE FROM users WHERE email = ANY($1)', [
        [sharedEmail, deletedEmail, `e2e-owner-${suffix}@roviq.test`],
      ]);
    });

    async function create(slug: string, email: string) {
      return gql(
        E2eAdminCreateResellerDocument,
        {
          input: { name: `E2E ${slug}`, slug, tier: 'READ_ONLY', initialAdminEmail: email },
        },
        adminToken,
      );
    }

    it('links the existing user instead of creating a second one', async () => {
      const first = await create(`e2e-ex1-${suffix}`, sharedEmail);
      expect(first.errors).toBeUndefined();
      assert(first.data);
      createdIds.push(first.data.adminCreateReseller.id);

      const second = await create(`e2e-ex2-${suffix}`, sharedEmail);
      expect(second.errors).toBeUndefined();
      assert(second.data);
      createdIds.push(second.data.adminCreateReseller.id);
      expect(second.data.adminCreateReseller.teamSize).toBe(1);

      const users = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
        sharedEmail,
      ]);
      expect(users.rows).toHaveLength(1);
      const members = await pool.query<{ user_id: string }>(
        'SELECT user_id FROM reseller_memberships WHERE reseller_id = ANY($1)',
        [createdIds],
      );
      expect(members.rows).toEqual([{ user_id: users.rows[0].id }, { user_id: users.rows[0].id }]);
    });

    it('does not link an account whose Roviq ID merely equals the email', async () => {
      const lookalike = `e2e-lookalike-${suffix}@roviq.test`;
      const owner = await create(`e2e-own-${suffix}`, `e2e-owner-${suffix}@roviq.test`);
      expect(owner.errors).toBeUndefined();
      assert(owner.data);
      createdIds.push(owner.data.adminCreateReseller.id);
      await pool.query('UPDATE users SET username = $1 WHERE email = $2', [
        lookalike,
        `e2e-owner-${suffix}@roviq.test`,
      ]);

      const slug = `e2e-look-${suffix}`;
      const res = await create(slug, lookalike);
      assert(res.errors);
      expect(res.errors[0].extensions?.code).toBe('RESELLER_ADMIN_EMAIL_UNAVAILABLE');
      const rows = await pool.query('SELECT 1 FROM resellers WHERE slug = $1', [slug]);
      expect(rows.rowCount).toBe(0);
    });

    it('rejects an email owned by a deleted user and creates nothing', async () => {
      const seeded = await create(`e2e-del-${suffix}`, deletedEmail);
      expect(seeded.errors).toBeUndefined();
      assert(seeded.data);
      createdIds.push(seeded.data.adminCreateReseller.id);
      await pool.query('UPDATE users SET deleted_at = now() WHERE email = $1', [deletedEmail]);

      const slug = `e2e-del2-${suffix}`;
      const res = await create(slug, deletedEmail);
      assert(res.errors);
      expect(res.errors[0].extensions?.code).toBe('RESELLER_ADMIN_EMAIL_UNAVAILABLE');
      const rows = await pool.query('SELECT 1 FROM resellers WHERE slug = $1', [slug]);
      expect(rows.rowCount).toBe(0);
    });
  });

  describe('adminChangeResellerTier (ROV-234)', () => {
    it('rejects tier change on the system reseller', async () => {
      const res = await gql(
        E2eAdminChangeResellerTierDocument,
        { id: '00000000-0000-7000-a000-000000000011', tier: 'READ_ONLY' },
        adminToken,
      );
      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].message).toMatch(/cannot have its tier changed/i);
    });

    it('changes the tier of an active reseller', async () => {
      await pool.query(
        `UPDATE resellers SET status='ACTIVE', is_active=true, suspended_at=NULL, tier='FULL_MANAGEMENT' WHERE id=$1`,
        [TEST_RESELLER_ID],
      );

      const res = await gql(
        E2eAdminChangeResellerTierDocument,
        { id: TEST_RESELLER_ID, tier: 'READ_ONLY' },
        adminToken,
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.adminChangeResellerTier.tier).toBe('READ_ONLY');

      // Verify DB state
      const after = await pool.query<{ tier: string }>(`SELECT tier FROM resellers WHERE id = $1`, [
        TEST_RESELLER_ID,
      ]);
      expect(after.rows[0].tier).toBe('READ_ONLY');
    });

    it('moves the reseller staff onto its own copy of the new tier role', async () => {
      const suffix = Date.now().toString(36);
      const created = await gql(
        E2eAdminCreateResellerDocument,
        {
          input: {
            name: `E2E Tier ${suffix}`,
            slug: `e2e-tier-${suffix}`,
            tier: 'FULL_MANAGEMENT',
            initialAdminEmail: `e2e-tier-${suffix}@roviq.test`,
          },
        },
        adminToken,
      );
      expect(created.errors).toBeUndefined();
      assert(created.data);
      const resellerId = created.data.adminCreateReseller.id;

      try {
        const res = await gql(
          E2eAdminChangeResellerTierDocument,
          { id: resellerId, tier: 'READ_ONLY' },
          adminToken,
        );
        expect(res.errors).toBeUndefined();

        const viewer = (await getResellerRoles(pool, resellerId)).find(
          (r) => r.name === 'reseller_viewer',
        );
        assert(viewer);
        const memberships = await pool.query<{ role_id: string }>(
          'SELECT role_id FROM reseller_memberships WHERE reseller_id = $1',
          [resellerId],
        );
        expect(memberships.rows).toEqual([{ role_id: viewer.id }]);
      } finally {
        const staff = await pool.query<{ user_id: string }>(
          'SELECT user_id FROM reseller_memberships WHERE reseller_id = $1',
          [resellerId],
        );
        await deleteTestReseller(pool, resellerId);
        for (const { user_id } of staff.rows) {
          await pool.query('DELETE FROM users WHERE id = $1', [user_id]);
        }
      }
    });

    it('rejects tier change when reseller is suspended', async () => {
      await gql(
        E2eAdminSuspendResellerDocument,
        { id: TEST_RESELLER_ID, reason: 'tier-test' },
        adminToken,
      );

      const res = await gql(
        E2eAdminChangeResellerTierDocument,
        { id: TEST_RESELLER_ID, tier: 'FULL_MANAGEMENT' },
        adminToken,
      );

      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].message).toMatch(/unsuspend first/i);
    });
  });
});
