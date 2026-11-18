/** Upper bound for a single dependency check, so one hung dependency cannot stall `/health` or the poller. */
export const PROBE_TIMEOUT_MS = 2_000;

export interface ProbeResult {
  up: boolean;
  /** Round-trip time of the check in milliseconds (also set when the check failed). */
  responseMs: number;
  error?: string;
}

export async function runProbe(
  check: () => Promise<void>,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    await Promise.race([check(), timeout]);
    return { up: true, responseMs: performance.now() - started };
  } catch (err) {
    return {
      up: false,
      responseMs: performance.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
