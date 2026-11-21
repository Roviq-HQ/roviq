import { expect, test } from '../../shared/console-guardian';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/dashboard');
    await expect(page.getByTestId('dashboard-welcome-card')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('hides Get Started for an institute that already has students, staff and standards', async ({
    page,
  }) => {
    await expect(page.getByTestId('dashboard-quick-links')).toBeVisible();
    await expect(page.getByTestId('dashboard-get-started')).toHaveCount(0);
  });

  test('Quick Links section shows 4 links', async ({ page }) => {
    await expect(page.getByTestId('dashboard-quick-links')).toBeVisible();

    await expect(page.getByTestId('dashboard-quick-link-standards')).toBeVisible();
    await expect(page.getByTestId('dashboard-quick-link-subjects')).toBeVisible();
    await expect(page.getByTestId('dashboard-quick-link-users')).toBeVisible();
    await expect(page.getByTestId('dashboard-quick-link-settings')).toBeVisible();
  });

  test('quick links navigate to correct pages', async ({ page }) => {
    await page.getByTestId('dashboard-quick-link-standards').click();
    await expect(page).toHaveURL(/\/academics/, { timeout: 10_000 });

    await page.goto('/en/dashboard');
    await expect(page.getByTestId('dashboard-welcome-card')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('dashboard-quick-link-settings').click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10_000 });
  });
});
