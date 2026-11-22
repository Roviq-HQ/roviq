import { isObservable, lastValueFrom } from 'rxjs';

/** One `@EventPattern` handler as Nest registers it on the server. */
export interface ChainHandler<TCtx> {
  (data: unknown, ctx: TCtx): unknown;
  extras?: Record<string, unknown>;
}

/**
 * Nest's RPC exception filter turns a thrown error into an erroring Observable (with a plain
 * `{ status, message }` object), so a handler that failed still resolves.
 */
async function settle(result: unknown): Promise<void> {
  const value = await result;
  if (!isObservable(value)) return;
  try {
    await lastValueFrom(value, { defaultValue: undefined });
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(describeRejection(err));
  }
}

function describeRejection(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const { message } = err;
    if (typeof message === 'string') return message;
  }
  return JSON.stringify(err) ?? String(err);
}

/** Runs every handler for one delivery in registration order; the first failure fails it. */
export async function runHandlerChain<TCtx>(
  chain: readonly ChainHandler<TCtx>[],
  payload: unknown,
  ctx: TCtx,
): Promise<void> {
  for (const handler of chain) {
    await settle(handler(payload, ctx));
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
  return `{${entries.join(',')}}`;
}

/** One consumer serves a pattern, so every handler of it must ask for the same consumer. */
export function assertConsistentExtras<TCtx>(
  pattern: string,
  chain: readonly ChainHandler<TCtx>[],
): void {
  const [head, ...rest] = chain;
  const expected = canonical(head?.extras ?? {});
  for (const handler of rest) {
    const actual = canonical(handler.extras ?? {});
    if (actual !== expected) {
      throw new Error(
        `Handlers for "${pattern}" declare different consumer options: ${expected} vs ${actual}. ` +
          'One durable consumer serves the pattern, so they must match.',
      );
    }
  }
}
