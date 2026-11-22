import { expect, test as setup } from '@playwright/test';

// Catches the silent-stale-build trap when `reuseExistingServer: !CI` would
// otherwise reuse a port-bound server built with different NEXT_PUBLIC_* vars.
// EXPECTED is read from the same env the webServer config inlines so override
// flows don't false-fail.

const EXPECTED = {
  NEXT_PUBLIC_API_URL:
    process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${process.env.E2E_API_PORT ?? '3004'}`,
};

const WEB_PORT = process.env.E2E_WEB_PORT ?? '4201';
const PROBE_BASE = process.env.WEB_URL_INSTITUTE || `http://localhost:${WEB_PORT}`;

setup('web env matches E2E expectations', async ({ request }) => {
  const url = `${PROBE_BASE}/api/e2e-ready`;
  const res = await request.get(url, { timeout: 5_000 });
  expect(res.status(), `${url} returned non-200`).toBe(200);
  const body = (await res.json()) as { env: Record<string, string | null> };
  for (const [k, v] of Object.entries(EXPECTED)) {
    expect(
      body.env[k],
      `Stale webServer env: ${k} mismatch. ` +
        `Run: fuser -k ${WEB_PORT}/tcp 2>/dev/null; pnpm test:e2e:ui`,
    ).toBe(v);
  }
});
