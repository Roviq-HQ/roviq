/** A second reseller that owns no institute, built through GraphQL, and its removal. */
import assert from 'node:assert';
import type pg from 'pg';
import { vi } from 'vitest';
import { gql } from './gql-client';
import { waitForEmail } from './mailpit';

const NEW_PASSWORD = 'Two-Institute-Reseller-9';

const RESELLER_LOGIN = `mutation ($u: String!, $p: String!) {
  resellerLogin(username: $u, password: $p) { accessToken }
}`;

export interface SecondReseller {
  id: string;
  token: string;
}

/** Creates the reseller as the platform admin and signs its first admin in. */
export async function createSecondReseller(platformToken: string): Promise<SecondReseller> {
  const suffix = Date.now().toString(36);
  const email = `e2e-two-institute-${suffix}@roviq.test`;
  const created = await gql<{ adminCreateReseller: { id: string } }>(
    `mutation ($input: AdminCreateResellerInput!) { adminCreateReseller(input: $input) { id } }`,
    {
      input: {
        name: `E2E Two Institute ${suffix}`,
        slug: `e2e-two-institute-${suffix}`,
        tier: 'FULL_MANAGEMENT',
        initialAdminEmail: email,
      },
    },
    platformToken,
  );
  assert(!created.errors, JSON.stringify(created.errors));
  const id = created.data?.adminCreateReseller.id;
  assert(id);

  const welcome = await waitForEmail(email, 'Welcome to Roviq');
  const tempPassword = /^Temporary password: (\S+)$/m.exec(welcome.text)?.[1];
  assert(tempPassword);
  const first = await gql<{ resellerLogin: { accessToken: string } }>(RESELLER_LOGIN, {
    u: email,
    p: tempPassword,
  });
  const firstToken = first.data?.resellerLogin.accessToken;
  assert(firstToken, JSON.stringify(first.errors));
  const changed = await gql(
    `mutation ($c: String!, $n: String!) { changePassword(currentPassword: $c, newPassword: $n) }`,
    { c: tempPassword, n: NEW_PASSWORD },
    firstToken,
  );
  assert(!changed.errors, JSON.stringify(changed.errors));
  const fresh = await gql<{ resellerLogin: { accessToken: string } }>(RESELLER_LOGIN, {
    u: email,
    p: NEW_PASSWORD,
  });
  const token = fresh.data?.resellerLogin.accessToken;
  assert(token, JSON.stringify(fresh.errors));
  return { id, token };
}

/**
 * Removes the reseller, so later specs count the seeded resellers only. A mutation it was
 * refused is recorded in the audit log a moment after the call, and such a row would hold the
 * reseller in place: wait until no more arrive, then remove them first.
 */
export async function removeSecondReseller(pool: pg.Pool, id: string): Promise<void> {
  const auditRows = async () => {
    const res = await pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM audit_logs WHERE reseller_id = $1',
      [id],
    );
    return Number(res.rows[0]?.n);
  };
  let seen = -1;
  await vi.waitFor(
    async () => {
      const now = await auditRows();
      const settled = now === seen;
      seen = now;
      if (!settled) throw new Error('audit rows of the second reseller are still arriving');
    },
    { timeout: 30_000, interval: 1_000 },
  );
  await pool.query('DELETE FROM audit_logs WHERE reseller_id = $1', [id]);
  await pool.query('DELETE FROM reseller_memberships WHERE reseller_id = $1', [id]);
  await pool.query('DELETE FROM roles WHERE reseller_id = $1', [id]);
  await pool.query('DELETE FROM resellers WHERE id = $1', [id]);
}
