import { NOTIFICATION_REDIS_KEYS } from '@roviq/redis';
import type Redis from 'ioredis';
import { LuaScript, NOW_MS_LUA, pairOf } from './lua-script';

/** Consecutive "cannot send now" answers inside `BREAKER_WINDOW_MS` that open a breaker. */
export const BREAKER_FAILURES = 5;
export const BREAKER_WINDOW_MS = 60_000;
/** How long an open breaker refuses before it lets one probe through. */
export const BREAKER_COOLDOWN_MS = 60_000;
/** A probe that never reports back (a crashed instance) frees the half-open slot after this. */
export const BREAKER_PROBE_LEASE_MS = 30_000;

export interface BreakerOptions {
  failures: number;
  windowMs: number;
  cooldownMs: number;
  probeLeaseMs: number;
}

const DEFAULTS: BreakerOptions = {
  failures: BREAKER_FAILURES,
  windowMs: BREAKER_WINDOW_MS,
  cooldownMs: BREAKER_COOLDOWN_MS,
  probeLeaseMs: BREAKER_PROBE_LEASE_MS,
};

/** ARGV: probe lease ms. {1, 0} pass; {1, 1} pass as the one probe; {0, retryAt} refused. */
const ALLOW = new LuaScript(`${NOW_MS_LUA}
local s = redis.call('HMGET', KEYS[1], 'state', 'until')
local state, untilMs = s[1], tonumber(s[2])
if not state or state == 'closed' then return {1, 0} end
if untilMs and now < untilMs then return {0, untilMs} end
local lease = tonumber(ARGV[1])
redis.call('HSET', KEYS[1], 'state', 'half_open', 'until', now + lease)
redis.call('PEXPIRE', KEYS[1], lease * 4)
return {1, 1}
`);

/**
 * ARGV: failures, window ms, cooldown ms, trip (1: open at once). Answers {1, until} when this
 * failure opened the breaker, else {0, 0}. A failed probe reopens it.
 */
const FAIL = new LuaScript(`${NOW_MS_LUA}
local threshold, window, cooldown, trip = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4] == '1'
local s = redis.call('HMGET', KEYS[1], 'state', 'failures', 'since')
local state, failures, since = s[1] or 'closed', tonumber(s[2]) or 0, tonumber(s[3])
local function open()
  redis.call('HSET', KEYS[1], 'state', 'open', 'until', now + cooldown, 'failures', 0)
  redis.call('PEXPIRE', KEYS[1], cooldown * 10)
  return {1, now + cooldown}
end
if state == 'open' then
  if trip then redis.call('HSET', KEYS[1], 'until', now + cooldown) end
  return {0, 0}
end
if trip or state == 'half_open' then return open() end
if not since or now - since > window then
  failures, since = 1, now
else
  failures = failures + 1
end
if failures >= threshold then return open() end
redis.call('HSET', KEYS[1], 'state', 'closed', 'failures', failures, 'since', since)
redis.call('PEXPIRE', KEYS[1], window)
return {0, 0}
`);

/** A late success from a request sent before the breaker opened does not close it. */
const SUCCEED = new LuaScript(`
if redis.call('HGET', KEYS[1], 'state') == 'open' then return {0, 0} end
redis.call('DEL', KEYS[1])
return {1, 0}
`);

export type BreakerAnswer = { ok: true } | { ok: false; retryAt: Date };

/**
 * Closed / open / half-open per provider or sender, with its state in Redis so every instance
 * sees the same one. Only "cannot send now" failures count; a refused message proves the provider
 * answers and counts as success.
 */
export class ProviderBreaker {
  private readonly options: BreakerOptions;

  constructor(
    private readonly redis: Redis,
    options: Partial<BreakerOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  async allow(name: string): Promise<BreakerAnswer> {
    const [ok, at] = pairOf(
      await ALLOW.run(this.redis, [keyOf(name)], [this.options.probeLeaseMs]),
    );
    return ok === 1 ? { ok: true } : { ok: false, retryAt: new Date(at) };
  }

  async succeeded(name: string): Promise<void> {
    await SUCCEED.run(this.redis, [keyOf(name)], []);
  }

  /** True when this failure opened the breaker. */
  failed(name: string): Promise<boolean> {
    return this.fail(name, false);
  }

  /** Opens the breaker at once (the provider blocked the sender). True when it was not open. */
  trip(name: string): Promise<boolean> {
    return this.fail(name, true);
  }

  private async fail(name: string, trip: boolean): Promise<boolean> {
    const { failures, windowMs, cooldownMs } = this.options;
    const [opened] = pairOf(
      await FAIL.run(this.redis, [keyOf(name)], [failures, windowMs, cooldownMs, trip ? 1 : 0]),
    );
    return opened === 1;
  }
}

const keyOf = (name: string) => `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_BREAKER}${name}`;

/** The breaker of a provider of a channel that does not send through senders. */
export const adapterBreakerName = (channel: string, provider: string) =>
  `adapter:${channel}:${provider}`;
