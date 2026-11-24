import { createHash } from 'node:crypto';
import type Redis from 'ioredis';

/** A Lua script run by its SHA, loaded on the first NOSCRIPT answer. Atomic on the server. */
export class LuaScript {
  private readonly sha: string;

  constructor(private readonly source: string) {
    this.sha = createHash('sha1').update(source).digest('hex');
  }

  async run(redis: Redis, keys: readonly string[], args: readonly (string | number)[]) {
    try {
      return await redis.evalsha(this.sha, keys.length, ...keys, ...args);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('NOSCRIPT')) throw err;
      return redis.eval(this.source, keys.length, ...keys, ...args);
    }
  }
}

/** The `{ flag, epoch ms }` pair every script here answers with. */
export function pairOf(reply: unknown): [number, number] {
  if (!Array.isArray(reply) || reply.length !== 2) {
    throw new Error('Unexpected reply from a Redis script');
  }
  const [flag, at] = reply.map(Number);
  if (flag === undefined || at === undefined || Number.isNaN(flag) || Number.isNaN(at)) {
    throw new Error('Unexpected reply from a Redis script');
  }
  return [flag, at];
}

/** Server time in ms, so every instance reads the same clock. */
export const NOW_MS_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`;
