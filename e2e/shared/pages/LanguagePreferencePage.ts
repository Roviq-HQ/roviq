import assert from 'node:assert';
import { expect, type Page } from '@playwright/test';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  GetAccountLocaleDocument,
  SaveAccountLocaleDocument,
} from '../../api-gateway-e2e/src/__generated__/graphql';
import { gql } from '../../api-gateway-e2e/src/helpers/gql-client';

type Portal = 'admin' | 'reseller' | 'institute';

export class LanguagePreferencePage {
  constructor(
    private readonly page: Page,
    private readonly portal: Portal,
  ) {}

  async goto() {
    await this.page.goto(`/en/${this.portal}/account?tab=profile#language`);
    await expect(this.page.getByTestId(testIds.accountLocale.select)).toBeEnabled();
  }

  async readPreference(): Promise<string | null> {
    const response = await gql(GetAccountLocaleDocument, {}, await this.accessToken());
    expect(response.errors).toBeUndefined();
    assert(response.data);
    return response.data.myPreferredLocale;
  }

  async restorePreference(locale: string | null) {
    const response = await gql(
      SaveAccountLocaleDocument,
      { input: { locale } },
      await this.accessToken(),
    );
    expect(response.errors).toBeUndefined();
  }

  async select(locale: 'en' | 'hi' | 'browser') {
    await this.page.getByTestId(testIds.accountLocale.select).click();
    await this.page.getByTestId(testIds.accountLocale.option(locale)).click();
  }

  async expectHindi() {
    await expect(this.page).toHaveURL(
      new RegExp(`/hi/${this.portal}/account\\?tab=profile#language$`),
    );
    await expect(this.page.getByTestId(testIds.accountLocale.select)).toHaveText('हिन्दी');
    await expect(this.page.getByTestId(testIds.accountLocale.select)).toBeEnabled();
  }

  async temporarilyUseEnglish() {
    await this.page.getByTestId(testIds.layout.localeSwitcher).click();
    await this.page.getByTestId(testIds.layout.localeOption('en')).click();
    await expect(this.page).toHaveURL(new RegExp(`/en/${this.portal}/account`));
  }

  async refresh() {
    await this.page.reload();
  }

  private async accessToken(): Promise<string> {
    const scope = this.portal === 'admin' ? 'platform' : this.portal;
    const token = await this.page.evaluate(
      (authScope) =>
        sessionStorage.getItem(`roviq-${authScope}-access-token`) ??
        localStorage.getItem(`__e2e_session__roviq-${authScope}-access-token`),
      scope,
    );
    assert(token, 'An authenticated portal session is required');
    return token;
  }
}
