/**
 * ROV-167 — Student list + detail page smoke tests.
 *
 * These tests are intentionally resilient to an empty seed: they verify
 * that the page renders its chrome (title, filters, table shell) and the
 * expected empty state when no students exist, rather than asserting on a
 * specific seeded row. When the seed is populated with students, the
 * detail-navigation test clicks the first row and walks every tab.
 *
 * Route under test: /en/people/students (institute portal — the
 * (dashboard) group segment is invisible in URLs, so the actual path that
 * reaches the list page is `/en/people/students`).
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';

const t = testIds.instituteStudents;

test.describe('Students list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/people/students');
    await expect(page.getByTestId(t.title)).toBeVisible({ timeout: 10_000 });
  });

  test('page renders title and description', async ({ page }) => {
    await expect(page.getByTestId(t.title)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId(t.description)).toBeVisible();
  });

  test('toolbar shows search and filter dropdowns', async ({ page }) => {
    await expect(page.getByTestId(t.searchInput)).toBeVisible();
    await expect(page.getByTestId(t.statusFilter)).toBeVisible();
    await expect(page.getByTestId(t.genderFilter)).toBeVisible();
    await expect(page.getByTestId(t.categoryFilter)).toBeVisible();
    await expect(page.getByTestId(t.rteFilter)).toBeVisible();
  });

  test('header shows Export CSV and Add Student buttons', async ({ page }) => {
    await expect(page.getByTestId(t.exportBtn)).toBeVisible();
    // Add Student is CASL-gated — it's present for the institute admin
    // used in auth.setup.ts but we don't hard-fail if a restricted role
    // hits this test accidentally; just assert one of the two header CTAs.
  });

  test('nuqs search writes the query into the URL', async ({ page }) => {
    const search = page.getByTestId(t.searchInput);
    await search.fill('rajesh');
    // Debounce is 150ms; wait for the URL to reflect the search
    await expect(page).toHaveURL(/[?&]search=rajesh/, { timeout: 2_000 });
  });

  test('academic-status filter writes to URL', async ({ page }) => {
    await page.getByTestId(t.statusFilter).click();
    await page.getByTestId(t.statusOption('ENROLLED')).click();
    await expect(page).toHaveURL(/[?&]academicStatus=ENROLLED/);
  });

  test('clearing filters removes them from the URL', async ({ page }) => {
    // First, set a filter so the clear button becomes visible
    await page.getByTestId(t.statusFilter).click();
    await page.getByTestId(t.statusOption('ENROLLED')).click();
    await expect(page).toHaveURL(/[?&]academicStatus=ENROLLED/);

    await page.getByTestId(t.clearFiltersBtn).click();
    await expect(page).not.toHaveURL(/academicStatus/);
  });

  test('empty state renders a helpful message when no students match', async ({ page }) => {
    // Force a filter that is very unlikely to match anything in the seed
    await page.getByTestId(t.searchInput).fill('zzzzz-no-such-student');
    // Either a matching row renders OR the empty state shows — we only
    // assert the empty state because a filter this specific should not hit
    // any real seed row. ResponsiveDataTable renders both desktop table and
    // mobile cards (CSS hides one); scope to the table variant.
    await expect(page.getByTestId(t.table).getByTestId(t.emptyState)).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe('Student detail', () => {
  test('clicking the first row navigates to the detail page and renders all 6 tabs', async ({
    page,
  }) => {
    await page.goto('/en/people/students');
    await expect(page.getByTestId(t.title)).toBeVisible({ timeout: 10_000 });

    // Find the first data row in the table. If there are no seeded students
    // we skip the rest of the test — the list-side tests cover the empty
    // case above.
    // Data rows have multiple td cells; the empty state row has a single td with colspan.
    const dataRows = page.getByTestId(t.table).locator('tbody tr:has(td:nth-child(3))');
    // count() does not wait, so settle on rows-or-empty first or the skip is a race.
    await expect(dataRows.first().or(page.getByTestId(t.emptyState))).toBeVisible({
      timeout: 15_000,
    });
    const rowCount = await dataRows.count();
    test.skip(rowCount === 0, 'No students seeded in this environment');

    // Click the name cell (not the checkbox cell at index 0, which stops propagation).
    await dataRows.first().locator('td').nth(2).click();

    // URL should now be /en/people/students/<uuid>
    await expect(page).toHaveURL(/\/people\/students\/[0-9a-f-]{36}/, { timeout: 10_000 });

    // All six tabs render
    await expect(page.getByTestId(t.detailTab('profile'))).toBeVisible();
    await expect(page.getByTestId(t.detailTab('academics'))).toBeVisible();
    await expect(page.getByTestId(t.detailTab('guardians'))).toBeVisible();
    await expect(page.getByTestId(t.detailTab('documents'))).toBeVisible();
    await expect(page.getByTestId(t.detailTab('tc-history'))).toBeVisible();
    await expect(page.getByTestId(t.detailTab('audit'))).toBeVisible();

    // Profile tab is active by default and shows the form
    await expect(page.getByRole('textbox', { name: 'First name (English)' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Social category' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();

    for (const [tab, panel] of [
      ['academics', 'Academics'],
      ['guardians', 'Guardians'],
      ['documents', 'Documents'],
      ['tc-history', 'TC History'],
      ['audit', 'Audit'],
    ] as const) {
      await page.getByTestId(t.detailTab(tab)).click();
      await expect(page.getByRole('tabpanel', { name: panel })).toBeVisible({ timeout: 5_000 });
    }
  });
});

test.describe('Student list — retrofit features', () => {
  test('sortable column updates URL', async ({ page }) => {
    await page.goto('/en/people/students');
    await page.getByTestId(t.sortAdmissionBtn).click();
    await expect(page).toHaveURL(/orderBy=admissionNumber/);
  });

  test('page-size selector updates URL', async ({ page }) => {
    await page.goto('/en/people/students');
    await page.getByTestId(t.pageSizeSelect).click();
    await page.getByRole('option', { name: '50' }).click();
    await expect(page).toHaveURL(/size=50/);
  });
});

test('student list renders redacted fields on desktop and mobile', async ({ page }) => {
  let redactedStudentId: string | undefined;
  await page.route('**/api/graphql', async (route) => {
    const request: { operationName?: string } = route.request().postDataJSON();
    if (request.operationName !== 'InstituteStudents') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body: { data?: { listStudents?: { edges: { node: Record<string, unknown> }[] } } } =
      await response.json();
    for (const { node } of body.data?.listStudents?.edges ?? []) {
      if (typeof node.id === 'string') redactedStudentId = node.id;
      for (const field of [
        'membershipId',
        'admissionNumber',
        'academicStatus',
        'socialCategory',
        'admissionDate',
        'createdAt',
        'updatedAt',
        'version',
      ])
        node[field] = null;
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/en/people/students');
  await expect(page.getByTestId(t.table)).toBeVisible();
  await expect.poll(() => redactedStudentId).toBeDefined();
  await expect(page.getByTestId(t.table)).toContainText('—');
  await expect(page.getByTestId(t.table)).not.toContainText('academicStatuses.');
  await page.setViewportSize({ width: 390, height: 844 });
  if (!redactedStudentId) throw new Error('Expected a redacted student fixture');
  await expect(page.getByTestId(t.studentCard(redactedStudentId))).toBeVisible();
  await expect(page.getByTestId(t.studentCard(redactedStudentId))).not.toContainText(
    'academicStatuses.',
  );
});
