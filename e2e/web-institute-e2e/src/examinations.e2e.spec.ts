import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';
import { SEED } from '../../shared/seed-fixtures';

// These tests create exams + schemes against the same seeded year; keep them
// serial so list assertions don't race each other's mutations.
test.describe.configure({ mode: 'serial' });

const { instituteExaminations: ex } = testIds;
const YEAR = SEED.ACADEMIC_YEAR_INST1.id;
const EXAM_URL = `/institute/examinations?year=${YEAR}`;
const GRADING_URL = `/institute/examinations/grading-schemes?year=${YEAR}`;
const REPORT_CARDS_URL = `/institute/examinations/report-cards?year=${YEAR}`;

test.describe('Examinations UI', () => {
  test('lists exams and creates one through the wizard', async ({ page }) => {
    await page.goto(EXAM_URL);
    await expect(page.getByTestId(ex.page)).toBeVisible();
    await expect(page.getByTestId(ex.title)).toBeVisible();

    const name = `UI Mid Term ${Date.now()}`;
    await page.getByTestId(ex.createButton).click();
    await expect(page.getByTestId(ex.wizard)).toBeVisible();
    await page.getByTestId(ex.wizardNameInput).fill(name);
    await page.getByTestId(ex.wizardWeightInput).fill('100');
    await page.getByTestId(ex.wizardSubmitBtn).click();

    await expect(page.getByTestId(ex.wizard)).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 10_000 });
  });

  test('opens an exam detail page with its datesheet', async ({ page }) => {
    await page.goto(EXAM_URL);
    await expect(page.getByTestId(ex.table)).toBeVisible({ timeout: 10_000 });
    // Open the first exam in the list.
    await page.getByTestId(ex.table).getByRole('link').first().click();
    await expect(page.getByTestId(ex.detailPage)).toBeVisible({ timeout: 10_000 });
    // The datesheet table (ex.datesheet) only renders once rows exist; the
    // "add row" control is always present, so it anchors the datesheet section.
    await expect(page.getByTestId(ex.addScheduleBtn)).toBeVisible();
  });

  test('creates a scholastic grading scheme', async ({ page }) => {
    await page.goto(GRADING_URL);
    await expect(page.getByTestId(ex.gradingPage)).toBeVisible({ timeout: 10_000 });

    const name = `UI Scheme ${Date.now()}`;
    await page.getByTestId(ex.gradingCreateBtn).click();
    await page.getByTestId(ex.gradingNameInput).fill(name);
    await page.getByTestId(ex.gradingSubmitBtn).click();

    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
  });

  test('renders the report-cards page', async ({ page }) => {
    await page.goto(REPORT_CARDS_URL);
    await expect(page.getByTestId(ex.reportCardsPage)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(ex.reportCardsCreateBtn)).toBeVisible();
  });
});
