/** Helpers for specs that attempt a read or write as a database role. */
import type pg from 'pg';
import { expect } from 'vitest';

/** Run `fn` in a transaction that is always rolled back, starting as `roviq_admin`. */
export async function inRolledBackTx(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE roviq_admin');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

export async function become(
  client: pg.PoolClient,
  role: 'roviq_app' | 'roviq_reseller' | 'roviq_admin',
  vars: Record<string, string> = {},
): Promise<void> {
  await client.query(`SET LOCAL ROLE ${role}`);
  for (const [key, value] of Object.entries(vars)) {
    await client.query('SELECT set_config($1, $2, true)', [key, value]);
  }
}

export const asInstitute = (client: pg.PoolClient, tenantId: string) =>
  become(client, 'roviq_app', { 'app.current_tenant_id': tenantId });
export const asReseller = (client: pg.PoolClient, resellerId: string) =>
  become(client, 'roviq_reseller', { 'app.current_reseller_id': resellerId });

/** The statement must fail with `pattern`; the surrounding transaction stays usable. */
export async function expectRefused(
  client: pg.PoolClient,
  pattern: RegExp,
  text: string,
  params: unknown[] = [],
): Promise<void> {
  await client.query('SAVEPOINT attempt');
  await expect(client.query(text, params)).rejects.toThrow(pattern);
  await client.query('ROLLBACK TO SAVEPOINT attempt');
}
