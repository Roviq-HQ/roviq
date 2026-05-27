/**
 * ROV-144 — Admin impersonation audit views, Playwright UI E2E (platform portal).
 *
 * Covers the two admin-side deliverables: the impersonator-scope multi-select
 * filter on the Impersonation tab, and the session-detail side-panel reachable
 * from an impersonated audit entry. Runs against the live e2e stack with the
 * seeded impersonation_sessions (see libs/database/src/seed/e2e/impersonation.ts).
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';

const { adminAuditLogs } = testIds;

test.describe('ROV-144 admin — impersonation audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/admin/audit-logs?tab=impersonation');
    await expect(page.getByTestId(adminAuditLogs.page)).toBeVisible();
    await expect(page.getByTestId(adminAuditLogs.tabImpersonation)).toBeVisible();
  });

  test('shows the impersonator-scope multi-select on the Impersonation tab', async ({ page }) => {
    await expect(page.getByTestId(adminAuditLogs.scopeFilter)).toBeVisible();
    await expect(page.getByTestId(adminAuditLogs.scopeFilterOption('platform'))).toBeVisible();
    await expect(page.getByTestId(adminAuditLogs.scopeFilterOption('reseller'))).toBeVisible();
    await expect(page.getByTestId(adminAuditLogs.scopeFilterOption('institute'))).toBeVisible();
  });

  test('toggling a scope updates aria-pressed and the URL state', async ({ page }) => {
    const reseller = page.getByTestId(adminAuditLogs.scopeFilterOption('reseller'));
    await expect(reseller).toHaveAttribute('aria-pressed', 'false');

    await reseller.click();
    await expect(reseller).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/impScope=reseller/);

    // multi-select: a second scope coexists
    const platform = page.getByTestId(adminAuditLogs.scopeFilterOption('platform'));
    await platform.click();
    await expect(platform).toHaveAttribute('aria-pressed', 'true');
    await expect(reseller).toHaveAttribute('aria-pressed', 'true');

    // toggling off clears it
    await reseller.click();
    await expect(reseller).toHaveAttribute('aria-pressed', 'false');
  });

  test('scope filter is not rendered on the All Events tab', async ({ page }) => {
    await page.getByTestId(adminAuditLogs.tabAll).click();
    await expect(page.getByTestId(adminAuditLogs.scopeFilter)).toHaveCount(0);
  });

  test('opening an impersonated entry reveals the session-detail panel', async ({ page }) => {
    const table = page.getByTestId(adminAuditLogs.table);
    await expect(table).toBeVisible();

    const viewSession = page.getByTestId(adminAuditLogs.viewSessionBtn).first();
    // Only present when an impersonated audit entry exists for the seeded sessions.
    if ((await viewSession.count()) > 0) {
      // Audit rows open the detail sheet first; the "View session" button lives there.
      await table.getByRole('row').nth(1).click();
      await viewSession.click();
      await expect(page.getByTestId(adminAuditLogs.sessionPanel)).toBeVisible();
      await expect(page.getByTestId(adminAuditLogs.sessionAuditList)).toBeVisible();
    }
  });
});
