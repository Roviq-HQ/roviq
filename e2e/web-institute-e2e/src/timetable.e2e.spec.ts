import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';
import { SEED } from '../../shared/seed-fixtures';

const { instituteTimetable: tt } = testIds;
const YEAR = SEED.ACADEMIC_YEAR_INST1.id;

test.describe('Timetable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/en/timetable?year=${YEAR}`);
    await expect(page.getByTestId(tt.page)).toBeVisible({ timeout: 15_000 });
  });

  test('list page renders with the create action', async ({ page }) => {
    await expect(page.getByTestId(tt.title)).toBeVisible();
    await expect(page.getByTestId(tt.createButton)).toBeVisible();
  });

  test('create button opens the full-screen wizard with its key fields', async ({ page }) => {
    await page.getByTestId(tt.createButton).click();

    await expect(page.getByTestId(tt.wizard)).toBeVisible();
    await expect(page.getByTestId(`${tt.wizardNameInput}-en`)).toBeVisible();
    await expect(page.getByTestId(tt.sectionPicker)).toBeVisible();
    await expect(page.getByTestId(tt.wizardSubmitBtn)).toBeVisible();
  });

  test('creates a timetable through the wizard', async ({ page }) => {
    await page.getByTestId(tt.createButton).click();
    await expect(page.getByTestId(tt.wizard)).toBeVisible();

    const name = `E2E UI Timetable ${Date.now()}`;
    await page.getByTestId(`${tt.wizardNameInput}-en`).fill(name);

    // Effective date range (required); schedule fields default to 08:00 / 45 / 6 / Mon–Sat.
    await page.getByTestId(tt.wizardEffectiveFromInput).fill('2026-04-01');
    await page.getByTestId(tt.wizardEffectiveToInput).fill('2027-03-31');

    await expect(page.getByTestId(tt.sectionPicker)).toBeVisible();
    await page.getByTestId(tt.sectionPickerSelectAll).click();

    await page.getByTestId(tt.wizardSubmitBtn).click();

    // On success the dialog closes and the new timetable appears in the list.
    await expect(page.getByTestId(tt.wizard)).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
  });
});
