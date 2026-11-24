import { createHash } from 'node:crypto';
import { NOTIFICATION_REDIS_KEYS } from '@roviq/redis';
import type Redis from 'ioredis';
import { LuaScript, NOW_MS_LUA, pairOf } from './lua-script';

/**
 * At most one message to one person from one sender in this time. The provider limits how
 * often one number may message the same person; 6 seconds stays well inside it.
 */
export const RECIPIENT_GAP_MS = 6_000;
/** The share of a sender's second a non-critical digest send must leave for other messages. */
export const DIGEST_RESERVE = 0.3;
/** After the provider throttles a sender its rate halves, then doubles back once per this. */
export const THROTTLE_RECOVERY_STEP_MS = 5 * 60_000;
/** The slowest a throttled sender goes: one message in 10 seconds. */
export const MIN_THROTTLED_RATE = 0.1;
/** Throttles answered within this time of the last one are one event, not several halvings. */
export const THROTTLE_SETTLE_MS = 1_000;

export interface SenderRateOptions {
  recipientGapMs: number;
  digestReserve: number;
  recoveryStepMs: number;
}

const DEFAULTS: SenderRateOptions = {
  recipientGapMs: RECIPIENT_GAP_MS,
  digestReserve: DIGEST_RESERVE,
  recoveryStepMs: THROTTLE_RECOVERY_STEP_MS,
};

/** The rate a throttle left, recovering by doubling each step, never above the sender's own. */
const EFFECTIVE_RATE_LUA = `
local function effectiveRate(th, max, step, now)
  local paused, rate, at = tonumber(th[3]), tonumber(th[1]), tonumber(th[2])
  if paused and paused <= now then paused = nil end
  if rate and at then
    rate = math.min(max, rate * 2 ^ math.floor((now - at) / step))
  else
    rate = max
  end
  return rate, paused, at
end
`;

/**
 * KEYS: window, queue, recipient, throttle. ARGV: messages per second, reserve share (0 for
 * none), recipient gap ms, recovery step ms. Answers {1, now} with the message counted, or
 * {0, retryAt}.
 *
 * A sliding window: at most `rate` grants in any second (one in `1/rate` seconds below one a
 * second), so a full second's worth may go at once but never more within one second. A waiting
 * message is given its own slot (`queue`), so waiters wake one step apart instead of together.
 */
const TAKE = new LuaScript(`${NOW_MS_LUA}${EFFECTIVE_RATE_LUA}
local max, reserve, gap, step = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local rate, paused = effectiveRate(redis.call('HMGET', KEYS[4], 'rate', 'at', 'paused'), max, step, now)
if paused then return {0, paused} end

local window = math.ceil(1000 * math.max(1, 1 / rate))
local size = math.max(1, math.floor(rate * window / 1000))
local limit = size
if reserve > 0 then limit = math.max(1, math.floor(size * (1 - reserve))) end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])

local wait = 0
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], count - limit, count - limit, 'WITHSCORES')
  wait = tonumber(oldest[2]) + window - now
end
local recipientWait = 0
if gap > 0 then recipientWait = math.max(0, redis.call('PTTL', KEYS[3])) end

if wait <= 0 and recipientWait == 0 then
  redis.call('ZADD', KEYS[1], now, now .. ':' .. count)
  redis.call('PEXPIRE', KEYS[1], window)
  if gap > 0 then redis.call('SET', KEYS[3], '1', 'PX', gap) end
  return {1, now}
end
local answer = now + math.max(wait, recipientWait)
if wait > 0 then
  answer = math.max(answer, tonumber(redis.call('GET', KEYS[2])) or 0)
  local nextSlot = answer + math.ceil(window / size)
  redis.call('SET', KEYS[2], nextSlot, 'PX', nextSlot - now + window)
end
return {0, answer}
`);

/**
 * KEYS: throttle. ARGV: messages per second, recovery step ms, minimum rate, settle ms,
 * Retry-After ms (0 when the provider sent none). With Retry-After the sender pauses that long;
 * without it the current rate halves. Answers {1, when the sender may send again}.
 */
const THROTTLE = new LuaScript(`${NOW_MS_LUA}${EFFECTIVE_RATE_LUA}
local max, step, minRate, settle, retryAfter = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])
local rate, paused, at = effectiveRate(redis.call('HMGET', KEYS[1], 'rate', 'at', 'paused'), max, step, now)
local ttl = math.max(0, redis.call('PTTL', KEYS[1]))
if retryAfter > 0 then
  local untilMs = math.max(now + retryAfter, paused or 0)
  redis.call('HSET', KEYS[1], 'paused', untilMs)
  redis.call('PEXPIRE', KEYS[1], math.max(ttl, untilMs - now + 1000))
  return {1, untilMs}
end
if not (at and now - at < settle) then
  rate = math.max(minRate, rate / 2)
  redis.call('HSET', KEYS[1], 'rate', tostring(rate), 'at', now)
  local steps = math.max(1, math.ceil(math.log(max / rate) / math.log(2)))
  redis.call('PEXPIRE', KEYS[1], math.max(ttl, steps * step + 1000))
end
return {1, math.max(now + math.ceil(1000 / rate), paused or 0)}
`);

/** `grantedAt` is the Redis clock at the grant: the moment the rate is enforced on. */
export type RateAnswer = { ok: true; grantedAt: Date } | { ok: false; retryAt: Date };

export interface RateTake {
  senderId: string;
  messagesPerSecond: number;
  phone: string;
  /** A non-critical digest: it leaves the reserved share of the second to other messages. */
  reserve: boolean;
}

/**
 * Per-sender rate shared by every instance through Redis: `messages_per_second` in any second
 * (a burst of one second's worth), and one message per person per gap. Each check is one script.
 */
export class SenderRateLimiter {
  private readonly options: SenderRateOptions;

  constructor(
    private readonly redis: Redis,
    options: Partial<SenderRateOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  async take(input: RateTake): Promise<RateAnswer> {
    const [ok, at] = pairOf(
      await TAKE.run(
        this.redis,
        [
          `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_RATE}${input.senderId}`,
          `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_RATE}${input.senderId}:queue`,
          `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_RECIPIENT_RATE}${input.senderId}:${phoneHash(input.phone)}`,
          `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_THROTTLE}${input.senderId}`,
        ],
        [
          input.messagesPerSecond,
          input.reserve ? this.options.digestReserve : 0,
          this.options.recipientGapMs,
          this.options.recoveryStepMs,
        ],
      ),
    );
    return ok === 1 ? { ok: true, grantedAt: new Date(at) } : { ok: false, retryAt: new Date(at) };
  }

  /** The provider said "too many": pause for `retryAfterMs`, or halve the rate. When to try again. */
  async throttle(
    senderId: string,
    messagesPerSecond: number,
    retryAfterMs: number | null,
  ): Promise<Date> {
    const [, at] = pairOf(
      await THROTTLE.run(
        this.redis,
        [`${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_THROTTLE}${senderId}`],
        [
          messagesPerSecond,
          this.options.recoveryStepMs,
          MIN_THROTTLED_RATE,
          THROTTLE_SETTLE_MS,
          retryAfterMs ?? 0,
        ],
      ),
    );
    return new Date(at);
  }
}

/** Keys never hold a phone number. */
function phoneHash(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 32);
}
