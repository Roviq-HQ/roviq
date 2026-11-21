import type Redis from 'ioredis';
import { REDIS_KEYS } from './redis-keys';

export const TOKEN_VERSION_CACHE_TTL_SECONDS = 60;
// Must outlive the cache entry, or a stale lower version written by a racing guard could win.
const FLOOR_TTL_SECONDS = TOKEN_VERSION_CACHE_TTL_SECONDS + 10;

export function tokenVersionKeys(userId: string): { cache: string; floor: string } {
  const cache = `${REDIS_KEYS.TOKEN_VERSION}${userId}`;
  return { cache, floor: `${cache}:floor` };
}

/**
 * Make `TokenVersionGuard` refuse older access tokens on the very next request, without
 * waiting for its cache entry to expire. Call after the write that raised the version commits.
 */
export async function recordTokenVersion(
  redis: Redis,
  userId: string,
  version: number,
): Promise<void> {
  const keys = tokenVersionKeys(userId);
  await Promise.all([
    redis.set(keys.cache, String(version), 'EX', TOKEN_VERSION_CACHE_TTL_SECONDS),
    redis.set(keys.floor, String(version), 'EX', FLOOR_TTL_SECONDS),
  ]);
}
