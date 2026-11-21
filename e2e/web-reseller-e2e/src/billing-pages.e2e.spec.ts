import { testIds } from '@roviq/ui/testing/testid-registry';
import { ensureBillingFixture } from '../../shared/billing-fixture';
import { expect, test } from '../../shared/console-guardian';
import { SEED } from '../../shared/seed-fixtures';

const { resellerBillingDashboard, resellerBillingInvoices, resellerBillingSubscriptions } = testIds;
const { resellerBillingUpi } = testIds;

test.describe('Reseller billing pages', () => {
  test.beforeAll(async ({ request }) => {
    await ensureBillingFixture(request);
  });

  test('dashboard renders its metric cards', async ({ page }) => {
    await page.goto('/en/billing/dashboard');

    for (const metric of ['mrr', 'active', 'churn', 'overdue'] as const) {
      await expect(page.getByTestId(resellerBillingDashboard.metric(metric))).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test('invoices list renders and the status filter updates the URL', async ({ page }) => {
    await page.goto('/en/billing/invoices');
    await expect(page.getByTestId(resellerBillingInvoices.table)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(resellerBillingInvoices.statusFilter).click();
    await page.getByRole('option').first().click();

    await expect(page).toHaveURL(/[?&]status=/);
  });

  test('opening an invoice shows the detail sheet with line items', async ({ page }) => {
    await page.goto('/en/billing/invoices');
    const table = page.getByTestId(resellerBillingInvoices.table);
    await expect(table).toBeVisible({ timeout: 15_000 });

    await table.getByRole('row').filter({ hasText: SEED.INSTITUTE_1.name }).first().click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    // header row plus at least one line item
    await expect(sheet.getByRole('row')).not.toHaveCount(0);
    expect(await sheet.getByRole('row').count()).toBeGreaterThan(1);
  });

  test('subscriptions list opens a subscription detail sheet', async ({ page }) => {
    await page.goto('/en/billing/subscriptions');
    const table = page.getByTestId(resellerBillingSubscriptions.table);
    await expect(table).toBeVisible({ timeout: 15_000 });

    await table.getByRole('row').filter({ hasText: SEED.INSTITUTE_1.name }).first().click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(SEED.INSTITUTE_1.name)).toBeVisible();
  });

  test('UPI verification page renders the queue or its empty state', async ({ page }) => {
    await page.goto('/en/billing/upi-verification');

    await expect(
      page.getByTestId(resellerBillingUpi.table).or(page.getByTestId(resellerBillingUpi.empty)),
    ).toBeVisible({ timeout: 15_000 });
  });
});
