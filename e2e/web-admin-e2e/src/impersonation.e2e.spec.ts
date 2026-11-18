/**
 * Impersonation flow (ROV-183) — a platform admin views as an institute user.
 *
 * Starts from the admin user's Memberships tab, follows the new tab into the
 * institute portal, and checks the session on the admin sessions page. Each run
 * opens its own session and ends it, so the seeded sessions are left alone.
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';
import { SEED, SEED_IDS } from '../../shared/seed-fixtures';

const {
  adminImpersonationSessions: sessions,
  impersonation,
  impersonationBanner,
  layout,
} = testIds;

const REASON = `E2E check of the view-as flow ${Date.now()}`;

test.describe('Impersonation flow', () => {
  test('view as a teacher from their Memberships tab, then exit from the user menu', async ({
    page,
    context,
  }) => {
    await page.goto(`/en/admin/users/${SEED_IDS.USER_TEACHER}`);
    await page.getByTestId(testIds.adminUserDetail.tab('memberships')).click();
    await page
      .getByTestId(/^admin-user-impersonate-btn-/)
      .first()
      .click();

    const dialog = page.getByTestId(impersonation.dialog);
    await expect(dialog).toContainText(SEED.INSTITUTE_1.name);

    // A reason under 10 characters never reaches the server.
    await page.getByTestId(impersonation.reasonInput).fill('too short');
    await page.getByTestId(impersonation.submitBtn).click();
    await expect(page.getByTestId(impersonation.reasonError)).toBeVisible();

    await page.getByTestId(impersonation.reasonInput).fill(REASON);
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId(impersonation.submitBtn).click(),
    ]);

    const banner = tab.getByTestId(impersonationBanner.banner);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText('You are viewing as');
    // A platform admin's session may write.
    await expect(tab.getByTestId(impersonationBanner.viewOnlyBadge)).toHaveCount(0);

    // The token lives in sessionStorage, so it dies with the tab.
    const stored = await tab.evaluate(() => ({
      session: sessionStorage.getItem('roviq-impersonation-token') !== null,
      local: Object.keys(localStorage).some((key) => key.includes('impersonation')),
    }));
    expect(stored).toEqual({ session: true, local: false });

    // The admin's own tab stays where it was, signed in, with the dialog gone.
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/admin/users/${SEED_IDS.USER_TEACHER}`));

    // The session shows as active on the sessions page.
    await page.goto('/en/admin/impersonation-sessions');
    const row = page.getByRole('row').filter({ hasText: REASON });
    await expect(row).toContainText('Active');
    await expect(row).toContainText('Platform');

    // The banner takes its own row: the user menu under it is reachable, and
    // "Log out" there has become Exit.
    await tab.bringToFront();
    await tab.getByTestId(layout.userMenuTrigger).click();
    const exit = tab.getByTestId(layout.userMenuLogout);
    await expect(exit).toHaveText('Exit Impersonation');
    await Promise.all([tab.waitForEvent('close'), exit.click()]);

    // The sessions page hears about it without a reload: nothing active with this reason.
    await page.bringToFront();
    await expect(row).toHaveCount(0);
    await page.getByTestId(sessions.showFilter).click();
    await page.getByRole('option', { name: 'All sessions' }).click();
    await expect(row).toContainText('Ended');

    // Exiting the impersonated tab did not sign the admin out.
    await page.reload();
    await expect(page.getByTestId(sessions.page)).toBeVisible();
  });
});
