/**
 * Bulk student import — happy path against the e2e stack (the import worker runs there).
 *
 * A CSV with two valid rows and one impossible date creates two students, reports one error and
 * offers a report naming the bad row. The page is refreshed after the import to prove the
 * progress view resumes from the URL.
 */
import path from 'node:path';

import { deleteStudentViaApi, instituteGraphql } from '../../shared/api-client';
import { expect, test } from '../../shared/console-guardian';
import { StudentImportPage } from './pages/StudentImportPage';

const INSTITUTE_AUTH_PATH = path.join(
  __dirname,
  '..',
  '..',
  'playwright',
  '.auth',
  'institute.json',
);

const unique = Date.now();
const LAST_NAME = `Import${unique}`;

const CSV = [
  'Student Name,last_name,DOB,gender',
  `Riya,${LAST_NAME},12/05/2014,female`,
  `Kabir,${LAST_NAME},2013-11-02,male`,
  `Meera,${LAST_NAME},31/02/2014,female`,
].join('\n');

test.describe('Students — CSV import', () => {
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: INSTITUTE_AUTH_PATH });
    const page = await context.newPage();
    await page.goto('/en/dashboard');
    const data = await instituteGraphql<{
      listStudents: { edges: Array<{ node: { id: string } }> };
    }>(
      page,
      /* GraphQL */ `query ImportCleanup($filter: StudentFilterInput) {
        listStudents(filter: $filter) { edges { node { id } } }
      }`,
      { filter: { search: LAST_NAME, first: 10 } },
    );
    for (const { node } of data.listStudents.edges) await deleteStudentViaApi(page, node.id);
    await context.close();
  });

  test('imports the valid rows and reports the bad one, surviving a refresh', async ({ page }) => {
    const importPage = new StudentImportPage(page);
    await importPage.goto();

    await importPage.chooseCsv('students.csv', CSV);
    await importPage.next().click();

    await importPage.chooseFirstClass();
    await importPage.next().click();

    await expect(importPage.mappingError()).toContainText('First name');
    await expect(importPage.start()).toBeDisabled();
    await importPage.mapColumn('Student Name', 'First name (required)');
    await importPage.mapColumn('DOB', 'Date of birth (DD/MM/YYYY) (required)');
    await expect(importPage.mappingError()).toHaveCount(0);

    await importPage.start().click();
    await expect(page).toHaveURL(/[?&]workflow=bulk-student-import-/);

    await page.reload();

    await expect(importPage.summary()).toBeVisible({ timeout: 60_000 });
    await expect(importPage.summary()).toContainText('2 students added, none skipped, 1 error.');
    await expect(importPage.count('created')).toHaveText('2');
    await expect(importPage.count('errors')).toHaveText('1');

    const reportUrl = await importPage.reportButton().getAttribute('href');
    expect(reportUrl).not.toBeNull();
    const report = await page.request.get(reportUrl ?? '');
    expect(report.ok()).toBe(true);
    const rows = (await report.text()).split(/\r?\n/).filter((line) => !line.startsWith('#'));
    expect(rows).toEqual([
      'row_number,field,error,original_value',
      '3,date_of_birth,Invalid date format. Expected DD/MM/YYYY or YYYY-MM-DD,31/02/2014',
    ]);
  });
});
