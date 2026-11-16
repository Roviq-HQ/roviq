import { expect, type Locator, type Page } from '@playwright/test';
import { testIds } from '@roviq/ui/testing/testid-registry';

const ids = testIds.instituteAttendance;

/** Page object for the attendance page and reports standard/section pickers. */
export class AttendanceScopePage {
  constructor(private readonly page: Page) {}

  async gotoAttendance(query = ''): Promise<void> {
    await this.page.goto(`/en/institute/attendance${query}`);
    await expect(this.page.getByTestId(ids.title)).toBeVisible({ timeout: 15_000 });
  }

  async gotoReports(tab: 'absentees' | 'daily' = 'absentees'): Promise<void> {
    await this.page.goto(`/en/institute/attendance/reports?tab=${tab}`);
    await expect(this.page.getByTestId(ids.reportsTitle)).toBeVisible({ timeout: 15_000 });
  }

  /** Waits until the page writes the server-resolved section into the URL. */
  async resolvedSectionId(): Promise<string> {
    await expect(this.page).toHaveURL(/[?&]section=[0-9a-f-]{36}/, { timeout: 15_000 });
    const value = new URL(this.page.url()).searchParams.get('section');
    expect(value).not.toBeNull();
    return value ?? '';
  }

  async openOptions(selectId: string): Promise<Locator> {
    await this.page.getByTestId(selectId).click();
    return this.page.getByRole('listbox').getByRole('option');
  }

  async closeOptions(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }
}
