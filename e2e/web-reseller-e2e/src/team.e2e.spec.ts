/**
 * ROV-185 — Reseller team page, Playwright UI E2E (reseller portal).
 *
 * The seeded reseller user is a full admin of Roviq Direct. Each run invites its
 * own uniquely named member and walks them through role change, deactivate and
 * reactivate, so the seeded member is never changed.
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';
import { SEED_CREDENTIALS } from '../../shared/seed-fixtures';

const { resellerTeam } = testIds;

test.describe('ROV-185 reseller — team', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/reseller/team');
    await expect(page.getByTestId(resellerTeam.table)).toBeVisible({ timeout: 15_000 });
  });

  test('lists the signed-in admin, marked as You, without row actions', async ({ page }) => {
    const self = page.getByRole('row').filter({ hasText: SEED_CREDENTIALS.RESELLER.username });
    await expect(self.getByTestId(resellerTeam.youBadge)).toBeVisible();
    await expect(self).toContainText('Reseller admin');
    await expect(self).toContainText('Active');
    await expect(self.getByRole('button')).toHaveCount(0);
  });

  test('opens the detail sheet with the member sessions, and keeps it in the URL', async ({
    page,
  }) => {
    await page.getByRole('row').filter({ hasText: SEED_CREDENTIALS.RESELLER.username }).click();

    await expect(page.getByTestId(resellerTeam.detailSheet)).toBeVisible();
    await expect(page).toHaveURL(/[?&]member=[0-9a-f-]{36}/);
    await expect(page.getByTestId(resellerTeam.detailSessions)).toBeVisible();
    await expect(page.getByTestId(resellerTeam.detailEmail)).not.toBeEmpty();

    await page.reload();
    await expect(page.getByTestId(resellerTeam.detailSheet)).toBeVisible();
  });

  test('rejects a malformed email before calling the server', async ({ page }) => {
    await page.getByTestId(resellerTeam.inviteBtn).click();
    await page.getByTestId(resellerTeam.inviteEmailInput).fill('not-an-email');
    await page.getByTestId(resellerTeam.inviteEmailInput).blur();

    await expect(page.getByTestId(resellerTeam.inviteDialog)).toContainText(
      'Invalid email address',
    );
    await expect(page.getByTestId(resellerTeam.inviteSubmitBtn)).toBeDisabled();
  });

  test('invite, change role, deactivate, filter and reactivate a member', async ({ page }) => {
    const email = `e2e.member.${Date.now()}@team.test`;
    const row = page.getByRole('row').filter({ hasText: email });

    await page.getByTestId(resellerTeam.inviteBtn).click();
    await page.getByTestId(resellerTeam.inviteEmailInput).fill(email);
    await page.getByTestId(resellerTeam.inviteRoleSelect).click();
    await page.getByRole('option', { name: 'Reseller support' }).click();
    await page.getByTestId(resellerTeam.inviteSubmitBtn).click();
    await expect(page.getByTestId(resellerTeam.inviteDialog)).toBeHidden();
    await expect(row).toContainText('Reseller support');
    await expect(row).toContainText('Never');

    await row.getByRole('button').click();
    await page.getByTestId(resellerTeam.actionChangeRole).click();
    await expect(page.getByTestId(resellerTeam.roleSubmitBtn)).toBeDisabled();
    await page.getByTestId(resellerTeam.roleSelect).click();
    await page.getByRole('option', { name: 'Reseller viewer' }).click();
    await page.getByTestId(resellerTeam.roleSubmitBtn).click();
    // A closing dialog hands focus back and would close a menu opened under it.
    await expect(page.getByTestId(resellerTeam.roleDialog)).toBeHidden();
    await expect(row).toContainText('Reseller viewer');

    await row.getByRole('button').click();
    await page.getByTestId(resellerTeam.actionDeactivate).click();
    await expect(page.getByTestId(resellerTeam.confirmDialog)).toContainText(email);
    await page.getByTestId(resellerTeam.confirmBtn).click();
    await expect(page.getByTestId(resellerTeam.confirmDialog)).toBeHidden();
    await expect(row).toContainText('Inactive');

    await page.getByTestId(resellerTeam.statusFilter).click();
    await page.getByRole('option', { name: 'Inactive' }).click();
    await expect(page).toHaveURL(/[?&]status=inactive/);
    await expect(row).toBeVisible();
    await expect(
      page.getByRole('row').filter({ hasText: SEED_CREDENTIALS.RESELLER.username }),
    ).toHaveCount(0);

    await row.getByRole('button').click();
    await page.getByTestId(resellerTeam.actionReactivate).click();
    await page.getByTestId(resellerTeam.confirmBtn).click();
    // Reactivated, so it leaves the inactive list.
    await expect(row).toHaveCount(0);

    await page.getByTestId(resellerTeam.clearFiltersBtn).click();
    await expect(row).toContainText('Active');
  });
});

test.describe('ROV-185 reseller — team in Hindi', () => {
  // With no saved account language the app follows the browser's.
  test.use({ locale: 'hi-IN' });

  test('renders in Hindi without horizontal overflow', async ({ page }) => {
    await page.goto('/hi/reseller/team');
    await expect(page.getByTestId(resellerTeam.title)).toHaveText('टीम');
    await expect(page.getByTestId(resellerTeam.table)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
