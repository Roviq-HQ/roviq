import type Redis from 'ioredis';
import { REDIS_KEYS } from './redis-keys';

// Must outlive the guard's 60s session cache, or the stale entry it shadows could win.
const TOMBSTONE_TTL_SECONDS = 70;

export function tombstoneKey(sessionId: string): string {
  return `${REDIS_KEYS.IMPERSONATION_SESSION}${sessionId}:tombstone`;
}

/**
 * Make `ImpersonationSessionGuard` reject these sessions on the very next request.
 *
 * A bare `del` is not enough: a guard that read the row before the session ended can
 * write its "still live" cache entry after the `del`. The guard checks the tombstone first.
 */
export async function invalidateImpersonationSessions(
  redis: Redis,
  sessionIds: readonly string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  await Promise.all([
    redis.del(...sessionIds.map((id) => `${REDIS_KEYS.IMPERSONATION_SESSION}${id}`)),
    ...sessionIds.map((id) => redis.set(tombstoneKey(id), '1', 'EX', TOMBSTONE_TTL_SECONDS)),
  ]);
}
