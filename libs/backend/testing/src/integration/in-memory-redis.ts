import { createMock } from '@golevelup/ts-vitest';
import type { Redis } from 'ioredis';

/**
 * Redis stand-in that actually stores values, for integration tests of flows
 * that read back what they wrote (one-time codes, OTP requests, tickets).
 * Covers the string commands those flows use; expiry is honoured lazily.
 */
export function createInMemoryRedis(): Redis {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };

  const expiryFrom = (args: unknown[]): number | null => {
    const mode = args.indexOf('EX');
    const seconds = mode === -1 ? undefined : args[mode + 1];
    return typeof seconds === 'number' ? Date.now() + seconds * 1000 : null;
  };

  return createMock<Redis>({
    get: async (key: string) => live(key)?.value ?? null,
    set: async (key: string, value: string | number, ...args: unknown[]) => {
      store.set(key, { value: String(value), expiresAt: expiryFrom(args) });
      return 'OK';
    },
    getdel: async (key: string) => {
      const value = live(key)?.value ?? null;
      store.delete(key);
      return value;
    },
    del: async (...keys: string[]) => keys.filter((key) => store.delete(key)).length,
    incr: async (key: string) => {
      const entry = live(key);
      const next = Number(entry?.value ?? 0) + 1;
      store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    expire: async (key: string, seconds: number) => {
      const entry = live(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },
    ttl: async (key: string) => {
      const entry = live(key);
      if (!entry) return -2;
      return entry.expiresAt === null ? -1 : Math.ceil((entry.expiresAt - Date.now()) / 1000);
    },
  });
}
