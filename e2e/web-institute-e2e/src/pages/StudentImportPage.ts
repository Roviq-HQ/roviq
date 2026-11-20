/**
 * Page Object for /people/students/import: the CSV import wizard and its progress view.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { testIds } from '@roviq/ui/testing/testid-registry';

const { instituteStudentImport: ids, fileUpload } = testIds;
const UPLOAD_NAME = 'student-import';

export class StudentImportPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/en/people/students/import');
    await expect(this.page.getByTestId(ids.title)).toBeVisible();
  }

  /** Picks a CSV as a Windows browser with Excel installed reports it. */
  async chooseCsv(name: string, contents: string): Promise<void> {
    await this.page.getByTestId(fileUpload.input(UPLOAD_NAME)).setInputFiles({
      name,
      mimeType: 'application/vnd.ms-excel',
      buffer: Buffer.from(contents),
    });
    await expect(this.page.getByTestId(fileUpload.item(name))).toHaveAttribute(
      'data-status',
      'done',
      { timeout: 20_000 },
    );
  }

  async chooseFirstClass(): Promise<void> {
    const standard = this.page.getByTestId(ids.standardSelect);
    await expect(standard).toBeEnabled({ timeout: 10_000 });
    await standard.click();
    await this.page.getByRole('option').first().click();
    const section = this.page.getByTestId(ids.sectionSelect);
    await expect(section).toBeEnabled({ timeout: 10_000 });
    await section.click();
    await this.page.getByRole('option').first().click();
  }

  async mapColumn(header: string, fieldLabel: string): Promise<void> {
    await this.page.getByTestId(ids.mappingSelect(header)).click();
    await this.page.getByRole('option', { name: fieldLabel, exact: true }).click();
  }

  next(): Locator {
    return this.page.getByTestId(ids.nextBtn);
  }

  start(): Locator {
    return this.page.getByTestId(ids.startBtn);
  }

  mappingError(): Locator {
    return this.page.getByTestId(ids.mappingError);
  }

  summary(): Locator {
    return this.page.getByTestId(ids.summary);
  }

  count(kind: 'created' | 'skipped' | 'errors'): Locator {
    const testId = {
      created: ids.createdCount,
      skipped: ids.skippedCount,
      errors: ids.errorCount,
    }[kind];
    return this.page.getByTestId(testId);
  }

  reportButton(): Locator {
    return this.page.getByTestId(ids.reportBtn);
  }
}
