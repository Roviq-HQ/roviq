import path from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { defineConfig, devices } from '@playwright/test';

// ── Portal URLs (E2E web port is separate from the dev web port) ──
const ADMIN_URL =
  process.env.WEB_URL_ADMIN || `http://admin.localhost:${process.env.E2E_WEB_PORT ?? '4201'}`;
const INSTITUTE_URL =
  process.env.WEB_URL_INSTITUTE || `http://localhost:${process.env.E2E_WEB_PORT ?? '4201'}`;
const RESELLER_URL =
  process.env.WEB_URL_RESELLER || `http://reseller.localhost:${process.env.E2E_WEB_PORT ?? '4201'}`;

// ── Auth state files ──
const adminAuth = path.join(__dirname, 'playwright/.auth/admin.json');
const instituteAuth = path.join(__dirname, 'playwright/.auth/institute.json');
const resellerAuth = path.join(__dirname, 'playwright/.auth/reseller.json');

const chrome = devices['Desktop Chrome'];

const ACCOUNT_LANGUAGE_SPEC = /language-preference\.e2e\.spec\.ts/;
const SHARED_USER_PROJECTS = ['admin', 'institute', 'reseller', 'cross-portal'];

export default defineConfig({
  globalSetup: './shared/preflight.ts',
  outputDir: path.join(workspaceRoot, 'dist/.playwright/e2e/test-output'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: path.join(workspaceRoot, 'dist/.playwright/e2e/report'),
        open: 'on-failure',
      },
    ],
  ],

  use: {
    trace: 'on-first-retry',
  },

  expect: {
    toHaveScreenshot: {
      // ~1% diff tolerance accommodates font/antialiasing variance.
      maxDiffPixelRatio: 0.01,
    },
  },

  // ── Project graph ──
  // 1. `web-env-check` runs first — fetches /api/e2e-ready and asserts the
  //    web server was built with the env vars E2E expects. With
  //    `reuseExistingServer: !CI`, this catches the silent-stale-build trap
  //    where a port-bound server from a different scope would otherwise be
  //    reused.
  // 2. Per-portal `*-setup` projects depend on `web-env-check` so the env
  //    assertion runs once before any auth state is produced.
  projects: [
    {
      name: 'web-env-check',
      testDir: './shared',
      testMatch: /web-env-check\.setup\.ts/,
      use: { ...chrome, baseURL: INSTITUTE_URL },
    },

    {
      name: 'admin-setup',
      testDir: './web-admin-e2e/src',
      testMatch: /.*\.setup\.ts/,
      use: { ...chrome, baseURL: ADMIN_URL },
      dependencies: ['web-env-check'],
    },
    {
      name: 'institute-setup',
      testDir: './web-institute-e2e/src',
      testMatch: /.*\.setup\.ts/,
      use: { ...chrome, baseURL: INSTITUTE_URL },
      dependencies: ['web-env-check'],
    },
    {
      name: 'reseller-setup',
      testDir: './web-reseller-e2e/src',
      testMatch: /.*\.setup\.ts/,
      use: { ...chrome, baseURL: RESELLER_URL },
      dependencies: ['web-env-check'],
    },

    // ── Login page tests (no auth needed) ──
    {
      name: 'admin-login',
      testDir: './web-admin-e2e/src',
      testMatch: /login\.e2e\.spec\.ts/,
      use: { ...chrome, baseURL: ADMIN_URL },
      dependencies: ['web-env-check'],
    },
    {
      name: 'institute-login',
      testDir: './web-institute-e2e/src',
      testMatch: /login\.e2e\.spec\.ts/,
      use: { ...chrome, baseURL: INSTITUTE_URL },
      dependencies: ['web-env-check'],
    },

    // ── Authenticated tests per portal ──
    {
      name: 'admin',
      testDir: './web-admin-e2e/src',
      testIgnore: [/login\.e2e\.spec\.ts/, /.*\.setup\.ts/, ACCOUNT_LANGUAGE_SPEC],
      use: { ...chrome, baseURL: ADMIN_URL, storageState: adminAuth },
      dependencies: ['admin-setup'],
    },
    {
      name: 'institute',
      testDir: './web-institute-e2e/src',
      testIgnore: [/login\.e2e\.spec\.ts/, /.*\.setup\.ts/],
      use: { ...chrome, baseURL: INSTITUTE_URL, storageState: instituteAuth },
      dependencies: ['institute-setup'],
    },
    {
      name: 'reseller',
      testDir: './web-reseller-e2e/src',
      testIgnore: [/.*\.setup\.ts/, ACCOUNT_LANGUAGE_SPEC],
      use: { ...chrome, baseURL: RESELLER_URL, storageState: resellerAuth },
      dependencies: ['reseller-setup'],
    },

    // ── Cross-portal tests (require all auth states) ──
    {
      name: 'cross-portal',
      testDir: './cross-portal/src',
      use: { ...chrome },
      dependencies: ['admin-setup', 'institute-setup', 'reseller-setup'],
    },

    // ── Account language journeys ──
    // They switch the signed-in user's saved language to Hindi for a while. The
    // seeded admin and reseller users are shared by every other spec, so these
    // run only after all of them have finished.
    {
      name: 'admin-account-language',
      testDir: './web-admin-e2e/src',
      testMatch: ACCOUNT_LANGUAGE_SPEC,
      use: { ...chrome, baseURL: ADMIN_URL, storageState: adminAuth },
      dependencies: SHARED_USER_PROJECTS,
    },
    {
      name: 'reseller-account-language',
      testDir: './web-reseller-e2e/src',
      testMatch: ACCOUNT_LANGUAGE_SPEC,
      use: { ...chrome, baseURL: RESELLER_URL, storageState: resellerAuth },
      dependencies: SHARED_USER_PROJECTS,
    },
  ],

  webServer: {
    command: 'pnpm run dev:web:e2e',
    // Point readiness at the build-fingerprint probe so a port-bound but
    // mis-built server fails fast instead of being treated as ready.
    url: `${INSTITUTE_URL}/api/e2e-ready`,
    name: 'Web',
    // Reuse a warm server locally; CI manages the lifecycle itself.
    reuseExistingServer: !process.env.CI,
    cwd: workspaceRoot,
    timeout: 120_000,
    env: {
      E2E_PROBE: '1',
      NEXT_PUBLIC_API_URL:
        process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${process.env.E2E_API_PORT ?? '3004'}`,
      NEXT_PUBLIC_NOVU_APPLICATION_IDENTIFIER: '',
    },
  },
});
