import pg from 'pg';

/** Any fixed number; every spec that creates the platform's messaging sender uses this one. */
const PLATFORM_SENDER_LOCK = 319_001;

/**
 * Only one live platform messaging sender may exist, and spec files run in parallel against
 * one database. A spec that creates one holds this lock from `beforeAll` to `afterAll`, and
 * removes its sender before releasing. Returns the release function.
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
