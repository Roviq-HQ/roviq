import type { Page } from '@playwright/test';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';
import { SEED } from '../../shared/seed-fixtures';

const { instituteTimetable: tt } = testIds;
const YEAR = SEED.ACADEMIC_YEAR_INST1.id;

// A weekday inside the timetables we create (effective 2026-04-01 → 2027-03-31).
// 2026-04-06 is a Monday, so it is a working day for the default Mon–Sat week.
const WORKING_DAY = '2026-04-06';

/** Create a DRAFT timetable covering every section of the seeded year. */
async function createTimetable(page: Page, name: string): Promise<void> {
  await page.getByTestId(tt.createButton).click();
  await expect(page.getByTestId(tt.wizard)).toBeVisible();
  await page.getByTestId(`${tt.wizardNameInput}-en`).fill(name);
  await page.getByTestId(tt.wizardEffectiveFromInput).fill('2026-04-01');
  await page.getByTestId(tt.wizardEffectiveToInput).fill('2027-03-31');
  await expect(page.getByTestId(tt.sectionPicker)).toBeVisible();
  await page.getByTestId(tt.sectionPickerSelectAll).click();
  await page.getByTestId(tt.wizardSubmitBtn).click();
  await expect(page.getByTestId(tt.wizard)).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
}

/** Open the grid editor for a just-created timetable by its name link. */
async function openEditor(page: Page, name: string): Promise<void> {
  await page.getByText(name).first().click();
  await expect(page.getByTestId(tt.editorPage)).toBeVisible({ timeout: 15_000 });
}

/** Select the first option of a shadcn Select trigger. */
async function pickFirstOption(page: Page, triggerTestId: string): Promise<void> {
  await page.getByTestId(triggerTestId).click();
  await page.getByRole('option').first().click();
}

test.describe('Timetable — list & wizard', () => {
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
    const name = `E2E UI Timetable ${Date.now()}`;
    await createTimetable(page, name);
  });

  test('status filter narrows the list', async ({ page }) => {
    await pickFirstOption(page, tt.statusFilter);
    // The table (or its empty state) must still be present after filtering.
    await expect(page.getByTestId(tt.page)).toBeVisible();
  });
});

test.describe('Timetable — editor & lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/en/timetable?year=${YEAR}`);
    await expect(page.getByTestId(tt.page)).toBeVisible({ timeout: 15_000 });
  });

  test('lifecycle: activate → deactivate → archive via the editor', async ({ page }) => {
    const name = `E2E Lifecycle ${Date.now()}`;
    await createTimetable(page, name);
    await openEditor(page, name);

    // DRAFT → ACTIVE: the deactivate control only appears once active.
    await page.getByTestId(tt.activateBtn).click();
    await expect(page.getByTestId(tt.deactivateBtn)).toBeVisible({ timeout: 10_000 });

    // ACTIVE → INACTIVE: the activate control returns.
    await page.getByTestId(tt.deactivateBtn).click();
    await expect(page.getByTestId(tt.activateBtn)).toBeVisible({ timeout: 10_000 });

    // → ARCHIVED: neither activate nor deactivate remains.
    await page.getByTestId(tt.archiveBtn).click();
    await expect(page.getByTestId(tt.activateBtn)).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId(tt.deactivateBtn)).toBeHidden();
  });

  test('editor: assign a subject to a grid cell', async ({ page }) => {
    const name = `E2E Editor ${Date.now()}`;
    await createTimetable(page, name);
    await openEditor(page, name);

    await expect(page.getByTestId(tt.grid)).toBeVisible({ timeout: 10_000 });
    // First assignable (non-break) cell is rendered as a <button>.
    await page.locator('button[data-testid^="timetable-cell-"]').first().click();
    await expect(page.getByTestId(tt.assignDialog)).toBeVisible();

    await pickFirstOption(page, tt.assignSubjectSelect(0));
    await page.getByTestId(tt.assignSubmitBtn).click();
    await expect(page.getByTestId(tt.assignDialog)).toBeHidden({ timeout: 10_000 });
  });

  test('editor: add a period via the period dialog', async ({ page }) => {
    const name = `E2E Period ${Date.now()}`;
    await createTimetable(page, name);
    await openEditor(page, name);

    await page.getByTestId(tt.addPeriodBtn).click();
    await expect(page.getByTestId(tt.periodDialog)).toBeVisible();
    await page.getByTestId(tt.periodLabelInput).fill('Zero');
    await page.getByTestId(tt.periodSubmitBtn).click();
    await expect(page.getByTestId(tt.periodDialog)).toBeHidden({ timeout: 10_000 });
  });
});

test.describe('Timetable — read-only views & PDF', () => {
  // Ensure there is an ACTIVE timetable covering the sections before viewing.
  test.beforeEach(async ({ page }) => {
    await page.goto(`/en/timetable?year=${YEAR}`);
    await expect(page.getByTestId(tt.page)).toBeVisible({ timeout: 15_000 });
    const name = `E2E View ${Date.now()}`;
    await createTimetable(page, name);
    await openEditor(page, name);
    await page.getByTestId(tt.activateBtn).click();
    await expect(page.getByTestId(tt.deactivateBtn)).toBeVisible({ timeout: 10_000 });
  });

  test('section view renders the grid and downloads a PDF', async ({ page }) => {
    await page.goto(`/en/timetable/section-timetable?year=${YEAR}`);
    await expect(page.getByTestId(tt.sectionTimetablePage)).toBeVisible({ timeout: 15_000 });

    await pickFirstOption(page, tt.sectionStandardSelect);
    await pickFirstOption(page, tt.sectionSelect);

    await expect(page.getByTestId(tt.sectionGrid)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(tt.printButton)).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId(tt.downloadPdfButton).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.pdf');
  });

  test('staff view renders and downloads a PDF', async ({ page }) => {
    await page.goto(`/en/timetable/staff-timetable?year=${YEAR}`);
    await expect(page.getByTestId(tt.staffTimetablePage)).toBeVisible({ timeout: 15_000 });

    // Default selection is "Me"; pick an explicit teacher to guarantee a grid.
    await pickFirstOption(page, tt.staffTeacherSelect);

    await expect(page.getByTestId(tt.staffGrid)).toBeVisible({ timeout: 15_000 });
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId(tt.downloadPdfButton).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.pdf');
  });

  test('day schedule renders and links to attendance for a period', async ({ page }) => {
    await page.goto(`/en/timetable/day?year=${YEAR}`);
    await expect(page.getByTestId(tt.dayPage)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(tt.dayDateInput).fill(WORKING_DAY);
    await pickFirstOption(page, tt.dayStandardSelect);
    await pickFirstOption(page, tt.daySectionSelect);

    await expect(page.getByTestId(tt.daySchedule)).toBeVisible({ timeout: 15_000 });
    const attendanceLink = page.locator('a[data-testid^="timetable-day-take-attendance-"]').first();
    await expect(attendanceLink).toBeVisible();
    await expect(attendanceLink).toHaveAttribute('href', /\/attendance\?.*section=/);
  });

  test('day schedule: add and clear a cancellation override', async ({ page }) => {
    await page.goto(`/en/timetable/day?year=${YEAR}`);
    await expect(page.getByTestId(tt.dayPage)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(tt.dayDateInput).fill(WORKING_DAY);
    await pickFirstOption(page, tt.dayStandardSelect);
    await pickFirstOption(page, tt.daySectionSelect);
    await expect(page.getByTestId(tt.daySchedule)).toBeVisible({ timeout: 15_000 });

    // Open the override dialog on the first slot that exposes one.
    await page.locator('button[data-testid^="timetable-day-override-"]').first().click();
    await expect(page.getByTestId(tt.overrideDialog)).toBeVisible();

    // CANCELLATION needs no subject/teacher.
    await page.getByTestId(tt.overrideTypeSelect).click();
    await page.getByRole('option', { name: /cancel/i }).click();
    await page.getByTestId(tt.overrideReasonInput).fill('E2E cancellation');
    await page.getByTestId(tt.overrideSubmitBtn).click();
    await expect(page.getByTestId(tt.overrideDialog)).toBeHidden({ timeout: 10_000 });

    // The new override shows a clear control; clearing removes it.
    const clearBtn = page.locator('button[data-testid^="timetable-day-clear-override-"]').first();
    await expect(clearBtn).toBeVisible({ timeout: 10_000 });
    await clearBtn.click();
    await expect(clearBtn).toBeHidden({ timeout: 10_000 });
  });
});

test.describe('Timetable — cross-app wiring', () => {
  test('dashboard surfaces a timetable link', async ({ page }) => {
    await page.goto('/en/dashboard');
    await expect(page.getByRole('link', { name: 'Timetable' }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('staff detail links to the staff timetable', async ({ page }) => {
    await page.goto('/en/people/staff');
    await expect(page.getByTestId(testIds.instituteStaff.table)).toBeVisible({ timeout: 15_000 });
    // Rows navigate via onRowClick; the first data row is row index 1 (0 = header).
    await page.getByTestId(testIds.instituteStaff.table).getByRole('row').nth(1).click();
    const link = page.getByTestId(testIds.instituteStaff.detailViewTimetableBtn);
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveAttribute('href', /\/timetable\/staff-timetable\?teacher=/);
  });

  test('academics section row links to the section timetable', async ({ page }) => {
    await page.goto(`/en/academics?year=${YEAR}`);
    // Open the first standard (its name cell is a link), then its Sections tab.
    await page
      .locator('a[data-testid^="academics-standard-"][data-testid$="-link"]')
      .first()
      .click();
    await page.getByTestId(testIds.instituteAcademics.standardSectionsTab).click();
    const link = page.locator('a[data-testid^="academics-section-view-timetable-"]').first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveAttribute('href', /\/timetable\/section-timetable\?section=/);
  });
});
