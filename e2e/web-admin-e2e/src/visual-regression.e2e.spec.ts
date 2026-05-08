import { expect, test } from '../../shared/console-guardian';

const RUN_VISUAL_SNAPSHOTS = process.env.E2E_VISUAL_SNAPSHOTS === '1';

/**
 * Visual regression baselines for the admin portal.
 *
 * Captures login + dashboard only — dynamic data tables (institutes,
 * audit-logs) are intentionally excluded because seeded timestamps and row
 * order drift between runs and produce noisy diffs.
 *
 * Re-baselining after an intentional UI change:
 *   pnpm e2e:up
 *   E2E_VISUAL_SNAPSHOTS=1 pnpm test:e2e:ui -- --update-snapshots
 *   git add e2e/web-admin-e2e/src/*-snapshots
 *
 * Pixel-diff tests opt out of a11y — axe already runs on functional tests.
 */
test.use({ checkAccessibility: false });
test.skip(!RUN_VISUAL_SNAPSHOTS, 'Set E2E_VISUAL_SNAPSHOTS=1 to run visual snapshots.');

test.describe('Admin portal — visual regression (unauthenticated)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login page', async ({ page }) => {
    await page.goto('/en/login');
    await expect(page.getByTestId('login-title')).toBeVisible();
    await expect(page).toHaveScreenshot('admin-login.png', {
      maxDiffPixels: 50,
      animations: 'disabled',
    });
  });
});

test.describe('Admin portal — visual regression (authenticated)', () => {
  test('dashboard', async ({ page }) => {
    await page.goto('/en/admin/dashboard');
    await expect(page.getByTestId('admin-dashboard-welcome-title')).toBeVisible();
    await expect(page.getByTestId('admin-dashboard-quick-links-title')).toBeVisible();
    await expect(page).toHaveScreenshot('admin-dashboard.png', {
      maxDiffPixels: 100,
      animations: 'disabled',
    });
  });
});
