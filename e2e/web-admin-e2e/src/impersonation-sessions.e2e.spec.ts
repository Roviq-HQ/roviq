/**
 * ROV-183 — admin impersonation sessions page, Playwright UI E2E.
 *
 * Reads the sessions seeded by libs/database/src/seed/e2e/impersonation.ts: an
 * active and an ended reseller session, and an active platform session. Terminate
 * is opened but never confirmed, so the seed stays as it is.
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';
import { SEED_IDS } from '../../shared/seed-fixtures';

const { adminImpersonationSessions: ids } = testIds;

test.describe('ROV-183 admin — impersonation sessions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/admin/impersonation-sessions');
    await expect(page.getByTestId(ids.table)).toBeVisible({ timeout: 15_000 });
  });

  test('is reachable from the sidebar', async ({ page }) => {
    await page.goto('/en/admin/dashboard');
    await page.getByRole('link', { name: 'Impersonation Sessions' }).click();
    await expect(page).toHaveURL(/\/admin\/impersonation-sessions$/);
    await expect(page.getByTestId(ids.title)).toBeVisible();
  });

  test('shows only active sessions by default, with the scope each was started from', async ({
    page,
  }) => {
    const resellerRow = page.getByTestId(ids.row(SEED_IDS.IMPERSONATION_SESSION_RESELLER_ACTIVE));
    const platformRow = page.getByTestId(ids.row(SEED_IDS.IMPERSONATION_SESSION_PLATFORM_ACTIVE));
    await expect(resellerRow).toContainText('Reseller');
    await expect(resellerRow).toContainText('Reseller assisting with attendance setup');
    await expect(platformRow).toContainText('Platform');
    await expect(
      page.getByTestId(ids.statusBadge(SEED_IDS.IMPERSONATION_SESSION_RESELLER_ACTIVE)),
    ).toHaveText('Active');
    await expect(
      page.getByTestId(ids.row(SEED_IDS.IMPERSONATION_SESSION_RESELLER_ENDED)),
    ).toHaveCount(0);
  });

  test('All sessions adds the ended one and keeps the choice in the URL', async ({ page }) => {
    await page.getByTestId(ids.showFilter).click();
    await page.getByRole('option', { name: 'All sessions' }).click();

    await expect(page).toHaveURL(/[?&]show=all/);
    const ended = SEED_IDS.IMPERSONATION_SESSION_RESELLER_ENDED;
    await expect(page.getByTestId(ids.statusBadge(ended))).toHaveText('Ended');
    await expect(page.getByTestId(ids.terminateBtn(ended))).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId(ids.row(ended))).toBeVisible();
  });

  test('Terminate asks first and can be cancelled', async ({ page }) => {
    const active = SEED_IDS.IMPERSONATION_SESSION_RESELLER_ACTIVE;
    await page.getByTestId(ids.terminateBtn(active)).click();

    const dialog = page.getByTestId(ids.terminateDialog);
    await expect(dialog).toContainText('will be signed out');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId(ids.statusBadge(active))).toHaveText('Active');
  });
});
