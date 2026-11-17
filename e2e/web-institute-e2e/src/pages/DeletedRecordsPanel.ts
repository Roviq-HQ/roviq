/**
 * Page Object for the Delete action on a person's detail page and the
 * "Deleted …" list on the students, staff and guardians list pages.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { testIds } from '@roviq/ui/testing/testid-registry';

const { deletedRecords } = testIds;

export type PersonKind = 'student' | 'staff' | 'guardian';

const LIST_PATH: Record<PersonKind, string> = {
  student: 'students',
  staff: 'staff',
  guardian: 'guardians',
};

export class DeletedRecordsPanel {
  constructor(
    private readonly page: Page,
    private readonly kind: PersonKind,
  ) {}

  async gotoList(locale: 'en' | 'hi' = 'en'): Promise<void> {
    await this.page.goto(`/${locale}/people/${LIST_PATH[this.kind]}`);
  }

  /** Detail page: open the confirmation and confirm the delete. */
  async deleteFromDetail(): Promise<void> {
    await this.page.getByTestId(deletedRecords.deleteBtn(this.kind)).click();
    await expect(this.page.getByTestId(deletedRecords.deleteDialog(this.kind))).toBeVisible();
    await this.page.getByTestId(deletedRecords.deleteConfirmBtn(this.kind)).click();
  }

  async expectBackOnList(): Promise<void> {
    await expect(this.page).toHaveURL(
      new RegExp(`/(institute/)?people/${LIST_PATH[this.kind]}(\\?.*)?$`),
    );
  }

  async open(): Promise<void> {
    await this.page.getByTestId(deletedRecords.openBtn(this.kind)).click();
    await expect(this.panel()).toBeVisible();
  }

  panel(): Locator {
    return this.page.getByTestId(deletedRecords.panel(this.kind));
  }

  row(id: string): Locator {
    return this.page.getByTestId(deletedRecords.row(id));
  }

  async restore(id: string): Promise<void> {
    await this.page.getByTestId(deletedRecords.restoreBtn(id)).click();
  }

  undoButton(): Locator {
    return this.page.getByRole('button', { name: 'Undo' });
  }
}
