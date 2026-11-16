/**
 * Preflight — ensures the Docker E2E stack is running before tests start.
 *
 * - If API is already healthy: skips Docker entirely (fast iteration).
 *   Code changes are picked up automatically via the bind mount + nx serve.
 * - If API is not reachable: runs `pnpm e2e:up` (starts the stack).
 *
 * For compose config changes, run `pnpm e2e:up` manually first.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const API_URL = process.env.API_URL || 'http://localhost:3004/api/graphql';
const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const PROBE_TIMEOUT_MS = 2_000;
const PROBE_INTERVAL_MS = 500;
// One probe misreads a busy machine (the web build has just finished) or a
// gateway mid-reload as "down" and triggers a full stack restart.
const READY_WINDOW_MS = 20_000;
const BOOT_WINDOW_MS = 120_000;

/** Resolves to `null` when the API answers, otherwise the reason it did not. */
async function probeApi(): Promise<string | null> {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const json = (await res.json()) as { data?: { __typename: string } };
    return json.data?.__typename === 'Query' ? null : `unexpected response (HTTP ${res.status})`;
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}

async function waitForApi(windowMs: number): Promise<string | null> {
  const deadline = Date.now() + windowMs;
  let reason = await probeApi();
  while (reason !== null && Date.now() < deadline) {
    await delay(PROBE_INTERVAL_MS);
    reason = await probeApi();
  }
  return reason;
}

export async function requireBackend(): Promise<void> {
  const reason = await waitForApi(READY_WINDOW_MS);
  if (reason === null) {
    console.log(`✓ API gateway already running at ${API_URL}`);
    return;
  }

  console.log(`API not reachable at ${API_URL} (${reason}) — api-gateway container log tail:`);
  spawnSync('docker', ['logs', '--tail', '40', 'roviq-e2e-api-gateway-1'], { stdio: 'inherit' });

  console.log('Starting Docker E2E stack (pnpm e2e:up)...');
  const result = spawnSync('pnpm', ['e2e:up'], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error('\n\x1b[31m✗ pnpm e2e:up failed\x1b[0m\n');
    process.exit(1);
  }

  let afterUp = await waitForApi(READY_WINDOW_MS);
  if (afterUp !== null) {
    // `e2e:up` leaves a running container alone, but `nx serve` parks after a
    // crash ("waiting for changes") — e.g. a reload that booted mid DB reset.
    console.log(`API still not reachable (${afterUp}) — restarting the api-gateway container...`);
    spawnSync('scripts/e2e-compose.sh', ['restart', 'api-gateway'], {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit',
    });
    afterUp = await waitForApi(BOOT_WINDOW_MS);
  }
  if (afterUp !== null) {
    console.error(
      `\n\x1b[31m✗ API gateway not reachable at ${API_URL} after restart (${afterUp})\x1b[0m\n`,
    );
    process.exit(1);
  }

  console.log(`✓ API gateway ready at ${API_URL}`);
}

export default requireBackend;
