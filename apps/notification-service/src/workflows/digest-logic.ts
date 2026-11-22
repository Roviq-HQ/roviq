/**
 * The digest workflow's logic without Temporal, so it can be tested directly. Must stay
 * deterministic: it runs inside the workflow sandbox.
 */

export interface DigestEntry<T> {
  dedupeKey: string;
  runAt: string;
  value: T;
}

/** Collects signalled items; a key seen once in this run is ignored after. */
export class DigestBuffer<T> {
  private readonly seen = new Set<string>();
  private pending: DigestEntry<T>[] = [];

  add(entry: DigestEntry<T>): void {
    if (this.seen.has(entry.dedupeKey)) return;
    this.seen.add(entry.dedupeKey);
    this.pending.push(entry);
  }

  drain(): T[] {
    const values = this.pending.map((e) => e.value);
    this.pending = [];
    return values;
  }

  /** Earliest window close among items not sent yet; null when there are none. */
  pendingRunAt(): number | null {
    if (this.pending.length === 0) return null;
    return Math.min(...this.pending.map((e) => Date.parse(e.runAt)));
  }
}

export interface DigestLoopEnv<T> {
  firstRunAt: number;
  sleepUntil(epochMs: number): Promise<void>;
  buffer: DigestBuffer<T>;
  send(items: T[]): Promise<void>;
}

/**
 * Sleep to the window close, send everything collected as one summary, then check again for
 * items that arrived meanwhile. Returns the number of summaries sent.
 */
export async function runDigestLoop<T>(env: DigestLoopEnv<T>): Promise<number> {
  let runAt = env.firstRunAt;
  let sent = 0;
  for (;;) {
    await env.sleepUntil(runAt);
    const items = env.buffer.drain();
    if (items.length === 0) return sent;
    await env.send(items);
    sent += 1;
    const next = env.buffer.pendingRunAt();
    if (next === null) return sent;
    runAt = next;
  }
}
