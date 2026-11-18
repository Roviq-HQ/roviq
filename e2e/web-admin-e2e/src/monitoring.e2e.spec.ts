/**
 * ROV-184 — platform-admin Monitoring page.
 * Asserts the live data the page renders, not just that it mounts.
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';

const { adminMonitoring: ids, metrics, layout } = testIds;

const SERVICES = ['API_GATEWAY', 'POSTGRES', 'REDIS', 'NATS', 'TEMPORAL', 'MINIO'] as const;
const STATUS_TEXT = /^(Healthy|Degraded|Down)$/;

test.describe('Admin Monitoring', () => {
  test('renders a status for every platform service', async ({ page }) => {
    await page.goto('/en/admin/monitoring');

    await expect(page.getByTestId(ids.title)).toHaveText('Monitoring');
    for (const service of SERVICES) {
      await expect(page.getByTestId(ids.serviceCard(service))).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId(metrics.serviceStatus(service))).toHaveText(STATUS_TEXT);
    }
    // The gateway answers the page's own requests, so it cannot be down.
    await expect(page.getByTestId(metrics.serviceStatus('API_GATEWAY'))).not.toHaveText('Down');
    await expect(page.getByTestId(ids.liveIndicator)).toBeVisible();
  });

  test('shows alerts, queue backlog, connections and institute activity', async ({ page }) => {
    await page.goto('/en/admin/monitoring');

    const alerts = page.getByTestId(ids.alertsPanel);
    await expect(alerts).toBeVisible({ timeout: 20_000 });
    await expect(
      alerts
        .getByTestId(ids.alertsUnavailable)
        .or(alerts.getByTestId(ids.alertsEmpty))
        .or(alerts.getByRole('listitem').first()),
    ).toBeVisible();

    await expect(page.getByTestId(ids.natsPanel)).toBeVisible();
    await expect(page.getByTestId(metrics.cardValue('websocket'))).toHaveText(/^\d[\d,]*$/, {
      timeout: 20_000,
    });
    await expect(page.getByTestId(metrics.cardValue('http'))).toHaveText(/^\d[\d,]*$/);

    const table = page.getByTestId(ids.tenantTable);
    await expect(table.getByRole('row').nth(1)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(ids.tenantPageInfo)).toBeVisible();
  });

  test('sorts institute activity by name and keeps the sort in the URL', async ({ page }) => {
    await page.goto('/en/admin/monitoring');
    const sortByName = page.getByTestId(ids.tenantSort('INSTITUTE_NAME'));
    await expect(page.getByTestId(ids.tenantPageInfo)).toBeVisible({ timeout: 20_000 });

    await sortByName.click();
    await expect(page).toHaveURL(/sort=INSTITUTE_NAME/);
    await expect(page).toHaveURL(/order=ASC/);
    await expect(page.getByRole('columnheader', { name: /Institute/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    await page.reload();
    await expect(page.getByRole('columnheader', { name: /Institute/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  test('is reachable from the sidebar', async ({ page }) => {
    await page.goto('/en/admin/dashboard');
    const sidebar = page.getByTestId(layout.desktopSidebar);
    await sidebar.getByRole('link', { name: 'Monitoring' }).click();

    await expect(page).toHaveURL(/\/monitoring/);
    await expect(page.getByTestId(ids.title)).toBeVisible();
  });

  test('links to the Observability charts instead of duplicating them', async ({ page }) => {
    await page.goto('/en/admin/monitoring');

    await expect(page.getByTestId(ids.observabilityLink)).toHaveAttribute(
      'href',
      /\/admin\/observability$/,
    );
  });
});
