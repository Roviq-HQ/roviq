/**
 * ROV-268 — attendance selectors only offer server-authorized sections.
 *
 * Seed contract: teacher1 is a class_teacher assigned to exactly one section
 * through the active seeded timetable; the institute admin sees every section.
 */
import { randomUUID } from 'node:crypto';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { expect, test } from '../../shared/console-guardian';
import { LoginPage } from '../../shared/pages/LoginPage';
import { E2E_USERS } from '../../shared/seed-fixtures';
import { AttendanceScopePage } from './pages/AttendanceScopePage';

const ids = testIds.instituteAttendance;

test.describe('Attendance section scope — single-section teacher', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(E2E_USERS.TEACHER.username, E2E_USERS.TEACHER.password);
    await login.expectRedirectToDashboard();
  });

  test('preselects the only assigned section and offers nothing else', async ({ page }) => {
    const attendance = new AttendanceScopePage(page);
    await attendance.gotoAttendance();

    const sectionId = await attendance.resolvedSectionId();
    await expect(page).toHaveURL(/[?&]standard=[0-9a-f-]{36}/);
    const options = await attendance.openOptions(ids.sectionSelect);
    await expect(options).toHaveCount(1);
    await expect(page.getByTestId(ids.sectionOption(sectionId))).toBeVisible();
  });

  test('replaces a tampered section id with the assigned section', async ({ page }) => {
    const attendance = new AttendanceScopePage(page);
    await attendance.gotoAttendance();
    const assigned = await attendance.resolvedSectionId();

    const tampered = randomUUID();
    await attendance.gotoAttendance(`?section=${tampered}`);

    await expect(page).toHaveURL(new RegExp(`[?&]section=${assigned}`), { timeout: 15_000 });
    await expect(page).not.toHaveURL(new RegExp(tampered));
  });

  test('reports default both tabs to the assigned standard and section', async ({ page }) => {
    const attendance = new AttendanceScopePage(page);
    await attendance.gotoAttendance();
    const assigned = await attendance.resolvedSectionId();

    await attendance.gotoReports('absentees');
    await expect(page).toHaveURL(new RegExp(`[?&]section=${assigned}`), { timeout: 15_000 });
    await expect(page.getByTestId(ids.absenteesSectionHint)).toHaveCount(0);
    const sectionOptions = await attendance.openOptions(ids.absenteesSectionSelect);
    await expect(sectionOptions).toHaveCount(1);
    await attendance.closeOptions();

    await page.getByTestId(ids.reportsTabDaily).click();
    await expect(page).toHaveURL(/[?&]breakdownStandard=[0-9a-f-]{36}/, { timeout: 15_000 });
    const standardOptions = await attendance.openOptions(ids.breakdownStandardSelect);
    await expect(standardOptions).toHaveCount(1);
  });
});

test.describe('Attendance section scope — institute admin', () => {
  test('keeps institute-wide choices without auto-selecting a section', async ({ page }) => {
    const attendance = new AttendanceScopePage(page);
    await attendance.gotoAttendance();

    await expect(page.getByText('Choose a section to take attendance')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]section=/);
    const standards = await attendance.openOptions(ids.standardSelect);
    await expect.poll(() => standards.count()).toBeGreaterThan(2);
  });
});
