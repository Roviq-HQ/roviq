import { expect, test } from '../../shared/console-guardian';

const RUN_VISUAL_SNAPSHOTS = process.env.E2E_VISUAL_SNAPSHOTS === '1';

/**
 * Visual regression baselines for the institute portal.
 * See admin spec for rationale and baseline-update workflow.
 */
test.use({ checkAccessibility: false });
test.skip(!RUN_VISUAL_SNAPSHOTS, 'Set E2E_VISUAL_SNAPSHOTS=1 to run visual snapshots.');

test.describe('Institute portal — visual regression (unauthenticated)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login page', async ({ page }) => {
    await page.goto('/en/login');
    await expect(page.getByTestId('login-title')).toBeVisible();
    await expect(page).toHaveScreenshot('institute-login.png', {
      maxDiffPixels: 50,
      animations: 'disabled',
    });
  });
});

test.describe('Institute portal — visual regression (authenticated)', () => {
  test('dashboard', async ({ page }) => {
    await page.goto('/en/dashboard');
    await expect(page.getByTestId('dashboard-welcome-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dashboard-quick-links')).toBeVisible();
    await expect(page).toHaveScreenshot('institute-dashboard.png', {
      maxDiffPixels: 100,
      animations: 'disabled',
    });
  });
});
