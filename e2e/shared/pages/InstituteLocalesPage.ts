import assert from 'node:assert';
import { expect, type Page } from '@playwright/test';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { gql } from '../../api-gateway-e2e/src/helpers/gql-client';

interface Settings {
  id: string;
  supportedLocales: string[];
  defaultLocale: string;
  version: number;
}
const { instituteLocales, instituteHoliday, layout } = testIds;

export class InstituteLocalesPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/en/settings/institute?tab=configuration');
    await expect(this.page.getByTestId(instituteLocales.defaultLanguage)).toBeVisible();
  }
  async currentSettings(): Promise<Settings> {
    const result = await gql<{ myInstitute: Settings }>(
      `query { myInstitute { id supportedLocales defaultLocale version } }`,
      {},
      await this.token(),
    );
    expect(result.errors).toBeUndefined();
    assert(result.data);
    return result.data.myInstitute;
  }
  async restore(settings: Settings) {
    const current = await this.currentSettings();
    const result = await gql(
      `mutation RestoreLocales($input: UpdateInstituteLocalesInput!) { updateInstituteLocales(input:$input) { id } }`,
      {
        input: {
          supportedLocales: settings.supportedLocales,
          defaultLocale: settings.defaultLocale,
          version: current.version,
        },
      },
      await this.token(),
    );
    expect(result.errors).toBeUndefined();
  }
  async enableTamil() {
    await this.page.getByTestId(instituteLocales.language('ta')).check();
    await this.page.getByTestId(instituteLocales.defaultLanguage).click();
    await this.page.getByTestId(instituteLocales.defaultOption('ta')).click();
    await this.page.getByTestId(instituteLocales.language('hi')).uncheck();
    await expect(this.page.getByTestId(instituteLocales.language('en'))).toBeDisabled();
    await expect(this.page.getByTestId(instituteLocales.language('ta'))).toBeDisabled();
    await this.page.getByTestId(instituteLocales.save).click();
    await expect.poll(async () => (await this.currentSettings()).defaultLocale).toBe('ta');
    await expect(this.page.getByTestId(instituteLocales.save)).toBeDisabled();
  }
  async expectTamilAfterRefresh() {
    await this.page.reload();
    await expect(this.page.getByTestId(instituteLocales.defaultLanguage)).toHaveText('தமிழ்');
    await expect(this.page.getByTestId(instituteLocales.language('hi'))).not.toBeChecked();
  }
  async expectTamilFormAndValidation() {
    await this.page.goto('/en/holiday/new');
    await expect(this.page.getByTestId(instituteHoliday.newName('ta'))).toBeVisible();
    await expect(this.page.getByTestId(instituteHoliday.newName('hi'))).toHaveCount(0);
    await this.page.getByTestId(instituteHoliday.newName('en')).fill('Regional language fixture');
    await this.page.getByTestId(instituteHoliday.newName('en')).blur();
    await this.page.getByTestId(instituteHoliday.newName('ta')).focus();
    await this.page.getByTestId(instituteHoliday.newName('ta')).blur();
    await expect(this.page.getByTestId(instituteHoliday.newName('ta'))).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await this.page.getByTestId(instituteHoliday.newName('ta')).fill('தமிழ்');
    await this.page.getByTestId(instituteHoliday.newName('ta')).blur();
    await expect(this.page.getByTestId(instituteHoliday.newName('ta'))).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
  }
  async expectInterfaceLanguagesUnchanged() {
    await this.page.getByTestId(layout.localeSwitcher).click();
    await expect(this.page.getByTestId(layout.localeOption('en'))).toBeVisible();
    await expect(this.page.getByTestId(layout.localeOption('hi'))).toBeVisible();
    await expect(this.page.getByTestId(layout.localeOption('ta'))).toHaveCount(0);
    await this.page.keyboard.press('Escape');
  }
  async switchTo(id: string) {
    await this.goto();
    if ((await this.currentSettings()).id === id) return;
    await this.page.getByTestId(layout.instituteSwitcher).click();
    await Promise.all([
      this.page.waitForEvent('domcontentloaded'),
      this.page.getByTestId(layout.instituteOption(id)).click(),
    ]);
    await expect(this.page.getByTestId(instituteLocales.defaultLanguage)).toBeVisible();
    expect((await this.currentSettings()).id).toBe(id);
  }
  async expectDefaultLanguage(locale: string) {
    await expect(this.page.getByTestId(instituteLocales.defaultLanguage)).toHaveText(locale);
  }
  private async token() {
    const token = await this.page.evaluate(
      () =>
        sessionStorage.getItem('roviq-institute-access-token') ??
        localStorage.getItem('__e2e_session__roviq-institute-access-token'),
    );
    assert(token);
    return token;
  }
}
