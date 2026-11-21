import type { InstituteStatus } from '@roviq/common-types';
import type Redis from 'ioredis';
import { REDIS_KEYS } from './redis-keys';

export const INSTITUTE_ACCESS_CACHE_TTL_SECONDS = 60;
// Must outlive the cache entry, or a stale "allowed" written by a racing guard could win.
const BLOCK_MARKER_TTL_SECONDS = INSTITUTE_ACCESS_CACHE_TTL_SECONDS + 10;

export const INSTITUTE_ACCESS = { ALLOWED: 'allowed', BLOCKED: 'blocked' } as const;

/** Only an ACTIVE institute may be logged into or used by its members. */
export function instituteAccessOf(status: InstituteStatus | undefined): string {
  return status === 'ACTIVE' ? INSTITUTE_ACCESS.ALLOWED : INSTITUTE_ACCESS.BLOCKED;
}

export function instituteAccessKeys(instituteId: string): { cache: string; blocked: string } {
  const cache = `${REDIS_KEYS.INSTITUTE_ACCESS}${instituteId}`;
  return { cache, blocked: `${cache}:blocked` };
}

/**
 * Make `InstituteAccessGuard` act on a status change on the very next request, without
 * waiting for its cache entry to expire. Call after the status write commits.
 */
export async function recordInstituteAccess(
  redis: Redis,
  instituteId: string,
  status: InstituteStatus,
): Promise<void> {
  const keys = instituteAccessKeys(instituteId);
  if (status === 'ACTIVE') {
    await redis.del(keys.cache, keys.blocked);
    return;
  }
  await Promise.all([
    redis.set(keys.cache, INSTITUTE_ACCESS.BLOCKED, 'EX', INSTITUTE_ACCESS_CACHE_TTL_SECONDS),
    redis.set(keys.blocked, '1', 'EX', BLOCK_MARKER_TTL_SECONDS),
  ]);
}
