import pg from 'pg';

/** Any fixed number; every spec that creates the platform's messaging sender uses this one. */
const PLATFORM_SENDER_LOCK = 319_001;

/** A `beforeAll` that takes the lock waits behind every other spec holding it, not the default 10 s. */
export const PLATFORM_SENDER_LOCK_WAIT_MS = 180_000;

/**
 * Test support. Only one live platform messaging sender may exist, and spec files run in
 * parallel against one database. A spec that creates one, also inside a transaction it rolls
 * back, holds this lock from `beforeAll` to `afterAll`, and removes its sender before
 * releasing. Returns the release function.
 *
 * It lives in this library so that this library's own specs can take it: the testing library
 * depends on this one, not the other way round.
 */
export async function holdPlatformSenderLock(
  connectionString: string,
): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query('SELECT pg_advisory_lock($1)', [PLATFORM_SENDER_LOCK]);
  return async () => {
    await client.query('SELECT pg_advisory_unlock($1)', [PLATFORM_SENDER_LOCK]);
    await client.end();
  };
}
