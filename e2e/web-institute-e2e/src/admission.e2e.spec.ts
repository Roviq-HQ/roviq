/**
 * ROV-168 — Admission pages smoke tests.
 *
 * Exercises the page shells of the three admission routes
 * (`/admission/enquiries`, `/admission/applications`, `/admission/statistics`)
 * behind an authenticated institute admin session, plus the two terminal
 * decisions an admin makes from the applications list (ROV-206): reject with
 * a reason, and approve & enrol into a section.
 */

import { expect, test } from '../../shared/console-guardian';
import { AdmissionApplicationsPage } from './pages/AdmissionApplicationsPage';

test.describe('Admission enquiries page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/institute/admission/enquiries');
    await expect(page.getByTestId('enquiries-title')).toBeVisible({ timeout: 10_000 });
  });

  test('renders the title and the primary toolbar controls', async ({ page }) => {
    await expect(page.getByTestId('enquiries-title')).toBeVisible();
    await expect(page.getByTestId('enquiries-search-input')).toBeVisible();
    await expect(page.getByTestId('enquiries-status-filter')).toBeVisible();
    await expect(page.getByTestId('enquiries-source-filter')).toBeVisible();
  });

  test('new-enquiry slide-over opens when the button is clicked', async ({ page }) => {
    await page.getByTestId('enquiries-new-btn').click();
    await expect(page.getByTestId('enquiry-form-title')).toBeVisible();
    await expect(page.getByTestId('enquiry-student-name-input')).toBeVisible();
    await expect(page.getByTestId('enquiry-parent-phone-input')).toBeVisible();
  });

  test('user can switch between table and kanban views', async ({ page }) => {
    const kanbanBtn = page.getByTestId('enquiries-view-kanban-btn');
    await kanbanBtn.click();
    await expect(page.getByTestId('enquiries-kanban')).toBeVisible();

    const tableBtn = page.getByTestId('enquiries-view-table-btn');
    await tableBtn.click();
    await expect(page.getByTestId('enquiries-table')).toBeVisible();
  });
});

test.describe('Admission applications page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/institute/admission/applications');
    await expect(page.getByTestId('applications-title')).toBeVisible({ timeout: 10_000 });
  });

  test('renders the title and the status filter', async ({ page }) => {
    await expect(page.getByTestId('applications-title')).toBeVisible();
    await expect(page.getByTestId('applications-status-filter')).toBeVisible();
    await expect(page.getByTestId('applications-rte-filter')).toBeVisible();
  });
});

test.describe('Admission application decisions', () => {
  test('rejecting stores the reason and shows it on the row after a reload', async ({ page }) => {
    const applications = new AdmissionApplicationsPage(page);
    await applications.goto();
    const id = await applications.createApplication(`UI Reject ${Date.now()}`);
    await page.reload();

    await applications.reject(id, 'Seats full for this class');

    await expect(applications.rejectionReason(id)).toContainText('Seats full for this class');
    await expect(applications.statusBadge(id)).toHaveText(/rejected/i);
    await page.reload();
    await expect(applications.rejectionReason(id)).toContainText('Seats full for this class');
    await expect(applications.rejectButton(id)).toHaveCount(0);
  });

  test('approving needs a section and ends with the applicant enrolled', async ({ page }) => {
    const applications = new AdmissionApplicationsPage(page);
    await applications.goto();
    const id = await applications.createApplication(`UI Enrol ${Date.now()}`);
    await applications.advanceToFeePaid(id);
    await page.reload();

    // Fee paid leaves only approval, so no status change is offered.
    await expect(applications.changeStatusButton(id)).toHaveCount(0);
    await applications.openApproveDialog(id);
    await expect(applications.approveConfirmButton()).toBeDisabled();
    await applications.chooseFirstSection();
    await applications.approveConfirmButton().click();

    // No reload: the workflow's applicationStatusChanged push updates the row.
    await expect(applications.statusBadge(id)).toHaveText(/enrolled/i, {
      timeout: 30_000,
    });
  });
});

test.describe('Admission statistics page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/institute/admission/statistics');
    await expect(page.getByTestId('statistics-title')).toBeVisible({ timeout: 10_000 });
  });

  test('renders either the KPI cards or the empty state', async ({ page }) => {
    // Seed may or may not include enquiries — accept either path.
    const totalEnq = page.getByTestId('kpi-total-enquiries');
    const empty = page.getByTestId('statistics-empty');
    await expect(totalEnq.or(empty)).toBeVisible({ timeout: 10_000 });
  });

  test('exposes the date-range selector tabs', async ({ page }) => {
    await expect(page.getByTestId('range-allTime')).toBeVisible();
    await expect(page.getByTestId('range-thisMonth')).toBeVisible();
    await expect(page.getByTestId('range-thisYear')).toBeVisible();
  });

  test('clicking a range tab marks it as selected', async ({ page }) => {
    const tab = page.getByTestId('range-thisMonth');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});
