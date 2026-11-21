import { testIds } from '@roviq/ui/testing/testid-registry';
import { ensureBillingFixture } from '../../shared/billing-fixture';
import { expect, test } from '../../shared/console-guardian';

const { instituteBillingOverview, instituteBillingInvoices, instituteBillingPayments } = testIds;

test.describe('Institute billing pages', () => {
  let fixture: Awaited<ReturnType<typeof ensureBillingFixture>>;

  test.beforeAll(async ({ request }) => {
    fixture = await ensureBillingFixture(request);
  });

  test('overview shows the current subscription', async ({ page }) => {
    await page.goto('/en/billing');

    await expect(page.getByTestId(instituteBillingOverview.subscriptionCard)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(instituteBillingOverview.statusBadge)).toBeVisible();
  });

  test('invoices table renders and a row click opens the invoice detail', async ({ page }) => {
    await page.goto('/en/billing/invoices');

    const table = page.getByTestId(instituteBillingInvoices.table);
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId(instituteBillingInvoices.invoiceLink(fixture.invoiceId)),
    ).toHaveText(fixture.invoiceNumber);

    await table.getByRole('row').filter({ hasText: fixture.invoiceNumber }).click();

    await expect(page).toHaveURL(new RegExp(`/billing/invoices/${fixture.invoiceId}$`));
    await expect(page.getByTestId(testIds.instituteBillingInvoice.lineItemRow(0))).toBeVisible({
      timeout: 15_000,
    });
  });

  test('payments page renders its list or empty state', async ({ page }) => {
    await page.goto('/en/billing/payments');

    await expect(
      page
        .getByTestId(instituteBillingPayments.list)
        .or(page.getByTestId(instituteBillingPayments.empty)),
    ).toBeVisible({ timeout: 15_000 });
  });
});
