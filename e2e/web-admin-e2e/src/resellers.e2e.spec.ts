import { expect, test } from '../../shared/console-guardian';
import { SEED, SEED_IDS } from '../../shared/seed-fixtures';

test.describe('Admin Resellers', () => {
  test.describe('Resellers list', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/en/admin/resellers');
    });

    test('page loads with title and description', async ({ page }) => {
      await expect(page.getByTestId('resellers-title')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('resellers-description')).toBeVisible();
    });

    test('filter controls render', async ({ page }) => {
      await expect(page.getByTestId('resellers-table')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('reseller-search-input')).toBeVisible();
      await expect(page.getByTestId('reseller-status-filter')).toBeVisible();
      await expect(page.getByTestId('reseller-tier-filter')).toBeVisible();
    });

    test('seeded Roviq Direct reseller is visible with system badge', async ({ page }) => {
      const nameCell = page.getByTestId(`reseller-name-cell-${SEED_IDS.RESELLER_DIRECT}`);
      await expect(nameCell).toBeVisible({ timeout: 15_000 });
      // The lock icon + "System Reseller" badge are rendered inside the name cell
      await expect(nameCell.getByText('System Reseller')).toBeVisible();
    });

    test('clicking a reseller row navigates to its detail page', async ({ page }) => {
      const nameCell = page.getByTestId(`reseller-name-cell-${SEED_IDS.RESELLER_DIRECT}`);
      await expect(nameCell).toBeVisible({ timeout: 15_000 });
      await nameCell.click();
      await expect(page).toHaveURL(/\/admin\/resellers\/[a-f0-9-]+/, { timeout: 10_000 });
    });

    test('Create Reseller button routes to the new page', async ({ page }) => {
      const createBtn = page.getByTestId('create-reseller-btn');
      await expect(createBtn).toBeVisible({ timeout: 15_000 });
      await createBtn.click();
      await expect(page).toHaveURL(/\/admin\/resellers\/new$/);
      await expect(page.getByTestId('new-reseller-title')).toBeVisible();
    });

    test('search input is reflected in the URL (nuqs)', async ({ page }) => {
      const search = page.getByTestId('reseller-search-input');
      await expect(search).toBeVisible({ timeout: 15_000 });
      await search.fill('roviq');
      // nuqs debounces the write, so wait for the URL to pick up the search param
      await expect(page).toHaveURL(/[?&]search=roviq/, { timeout: 5_000 });
    });
  });

  test.describe('System reseller detail page protection', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/en/admin/resellers');
      const nameCell = page.getByTestId(`reseller-name-cell-${SEED_IDS.RESELLER_DIRECT}`);
      await expect(nameCell).toBeVisible({ timeout: 15_000 });
      await nameCell.click();
      await expect(page).toHaveURL(/\/admin\/resellers\/[a-f0-9-]+/, { timeout: 10_000 });
    });

    test('loads with title, status, tier, and system badges', async ({ page }) => {
      await expect(page.getByTestId('reseller-detail-title')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('reseller-status-badge')).toBeVisible();
      await expect(page.getByTestId('reseller-tier-badge')).toBeVisible();
      await expect(page.getByTestId('reseller-system-badge')).toBeVisible();
      await expect(page.getByTestId('reseller-system-notice')).toBeVisible();
    });

    test('all five tabs are available', async ({ page }) => {
      await expect(page.getByTestId('reseller-detail-page')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('tab-overview')).toBeVisible();
      await expect(page.getByTestId('tab-institutes')).toBeVisible();
      await expect(page.getByTestId('tab-team')).toBeVisible();
      await expect(page.getByTestId('tab-activity')).toBeVisible();
      await expect(page.getByTestId('tab-billing')).toBeVisible();
    });

    test('system reseller shows its actions disabled with the reason', async ({ page }) => {
      await expect(page.getByTestId('reseller-actions')).toBeVisible({ timeout: 10_000 });
      for (const testId of [
        'action-edit-btn',
        'action-change-tier-btn',
        'action-suspend-btn',
        'action-delete-btn',
      ]) {
        const btn = page.getByTestId(testId);
        await expect(btn).toBeDisabled();
        await expect(btn).toHaveAttribute('title', 'System reseller cannot be modified');
      }
      await expect(page.getByTestId('action-unsuspend-btn')).toHaveCount(0);
    });

    test('Institutes tab lists the seeded institutes', async ({ page }) => {
      await page.getByTestId('tab-institutes').click();
      await expect(page.getByTestId(`reseller-institute-row-${SEED.INSTITUTE_1.id}`)).toContainText(
        SEED.INSTITUTE_1.name,
        { timeout: 10_000 },
      );
    });

    test('Team and Activity tabs render', async ({ page }) => {
      await page.getByTestId('tab-team').click();
      await expect(page.getByTestId('reseller-team-tab')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('tab-activity').click();
      await expect(page.getByTestId('reseller-activity-tab')).toBeVisible({ timeout: 10_000 });
    });

    test('invalid tab URL param falls back to overview', async ({ page }) => {
      await page.goto(`/en/admin/resellers/${SEED_IDS.RESELLER_DIRECT}?tab=totally-not-a-tab`);
      // Overview content (Identity card) must render; the invalid tab must NOT
      // leave the page blank.
      await expect(page.getByTestId('detail-name')).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('Create reseller form', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/en/admin/resellers/new');
    });

    test('form fields are all rendered', async ({ page }) => {
      await expect(page.getByTestId('new-reseller-title')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('reseller-name-input')).toBeVisible();
      await expect(page.getByTestId('reseller-slug-input')).toBeVisible();
      await expect(page.getByTestId('reseller-tier-select')).toBeVisible();
      await expect(page.getByTestId('reseller-admin-email-input')).toBeVisible();
      await expect(page.getByTestId('reseller-primary-color-input')).toBeVisible();
      await expect(page.getByTestId('reseller-custom-domain-input')).toBeVisible();
    });

    test('Cancel button returns to the list', async ({ page }) => {
      await expect(page.getByTestId('cancel-create-reseller-btn')).toBeVisible({
        timeout: 10_000,
      });
      await page.getByTestId('cancel-create-reseller-btn').click();
      await expect(page).toHaveURL(/\/admin\/resellers$/);
    });
  });
});
