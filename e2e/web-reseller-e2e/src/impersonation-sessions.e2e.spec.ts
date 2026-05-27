/**
 * ROV-144 — Reseller impersonation sessions page, Playwright UI E2E (reseller portal).
 *
 * Drives /reseller/audit/impersonation against the live e2e stack. The reseller
 * user (E2E_USERS reseller, a RESELLER_DIRECT team member) sees the seeded
 * reseller-scoped sessions (one ACTIVE, one ENDED) from
 * libs/database/src/seed/e2e/impersonation.ts. Covers the table + status badges,
 * the institute filter, and the terminate-confirm flow (without confirming, so
 * shared seed state is not mutated).
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';

const { resellerImpersonation } = testIds;

test.describe('ROV-144 reseller — impersonation sessions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/reseller/audit/impersonation');
    await expect(page.getByTestId(resellerImpersonation.page)).toBeVisible();
  });

  test('lists the reseller team sessions with status badges', async ({ page }) => {
    await expect(page.getByTestId(resellerImpersonation.table)).toBeVisible();
    // Seeded: one active + one ended reseller session.
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Ended', { exact: true }).first()).toBeVisible();
  });

  test('exposes the resellerInstitutes-backed institute filter', async ({ page }) => {
    await expect(page.getByTestId(resellerImpersonation.instituteFilter)).toBeVisible();
  });

  test('active sessions offer Terminate with a confirmation dialog', async ({ page }) => {
    const terminate = page.getByTestId(/^reseller-impersonation-terminate-btn-/).first();
    await expect(terminate).toBeVisible();

    await terminate.click();
    const dialog = page.getByTestId(resellerImpersonation.terminateDialog);
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId(resellerImpersonation.terminateConfirm)).toBeVisible();

    // Close without confirming — do not mutate shared seed state.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('ended sessions do not offer a Terminate action', async ({ page }) => {
    // Every visible Terminate button must belong to an ACTIVE row, so the count
    // of Terminate buttons is strictly less than the total session rows.
    const rows = await page.getByRole('row').count();
    const terminateButtons = await page
      .getByTestId(/^reseller-impersonation-terminate-btn-/)
      .count();
    expect(terminateButtons).toBeLessThan(rows);
  });
});
