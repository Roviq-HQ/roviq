import type Redis from 'ioredis';
import { REDIS_KEYS } from './redis-keys';

export const RESELLER_ACCESS_CACHE_TTL_SECONDS = 60;
// Must outlive the cache entry, or a stale "allowed" written by a racing guard could win.
const BLOCK_MARKER_TTL_SECONDS = RESELLER_ACCESS_CACHE_TTL_SECONDS + 10;

export const RESELLER_ACCESS = { ALLOWED: 'allowed', BLOCKED: 'blocked' } as const;

export function resellerAccessKeys(resellerId: string): { cache: string; blocked: string } {
  const cache = `${REDIS_KEYS.RESELLER_ACCESS}${resellerId}`;
  return { cache, blocked: `${cache}:blocked` };
}

/**
 * Make `ResellerAccessGuard` reject this reseller's tokens on the very next request,
 * without waiting for its cache entry to expire. Call after the suspension commits.
 */
export async function blockResellerAccess(redis: Redis, resellerId: string): Promise<void> {
  const keys = resellerAccessKeys(resellerId);
  await Promise.all([
    redis.set(keys.cache, RESELLER_ACCESS.BLOCKED, 'EX', RESELLER_ACCESS_CACHE_TTL_SECONDS),
    redis.set(keys.blocked, '1', 'EX', BLOCK_MARKER_TTL_SECONDS),
  ]);
}

/** Drop the cached answer so the guard re-reads the reseller. Call after an unsuspend commits. */
export async function clearResellerAccess(redis: Redis, resellerId: string): Promise<void> {
  const keys = resellerAccessKeys(resellerId);
  await redis.del(keys.cache, keys.blocked);
}

// Outlives a reseller access token (10 min), so no token issued before the change survives it.
const MEMBER_ACCESS_TTL_SECONDS = 11 * 60;

export const RESELLER_MEMBER_BLOCKED = 'blocked';

export function resellerMemberAccessKey(membershipId: string): string {
  return `${REDIS_KEYS.RESELLER_MEMBER_ACCESS}${membershipId}`;
}

/**
 * Make `ResellerAccessGuard` reject this member's already-issued access tokens: all of
 * them after a deactivation, those carrying another role after a role change. The
 * client's refresh then fails (deactivated) or picks up the new role.
 */
export async function requireResellerMemberRole(
  redis: Redis,
  membershipId: string,
  roleId: string | typeof RESELLER_MEMBER_BLOCKED,
): Promise<void> {
  await redis.set(resellerMemberAccessKey(membershipId), roleId, 'EX', MEMBER_ACCESS_TTL_SECONDS);
}
