import { expect, test } from './console-guardian';
import { LanguagePreferencePage } from './pages/LanguagePreferencePage';

export function languagePreferenceTests(portal: 'admin' | 'reseller' | 'institute') {
  test.describe('Account language preference', () => {
    // Both tests change the same account's saved language.
    test.describe.configure({ mode: 'serial' });

    let original: string | null | undefined;

    test.afterEach(async ({ page }) => {
      if (original !== undefined) {
        await new LanguagePreferencePage(page, portal).restorePreference(original);
      }
    });

    test('persists across refresh', async ({ page }) => {
      const account = new LanguagePreferencePage(page, portal);
      await account.goto();
      original = await account.readPreference();
      await account.select('hi');
      await account.expectHindi();
      expect(await account.readPreference()).toBe('hi');
      await account.refresh();
      await account.expectHindi();
      await account.select('browser');
      await expect.poll(() => account.readPreference()).toBeNull();
    });

    test('keeps a language picked in the topbar after a reload', async ({ page }) => {
      const account = new LanguagePreferencePage(page, portal);
      await account.goto();
      original = await account.readPreference();
      await account.switchInTopbar('hi');
      await expect.poll(() => account.readPreference()).toBe('hi');
      await account.refresh();
      await account.expectHindi();
      await account.switchInTopbar('en');
      await expect.poll(() => account.readPreference()).toBe('en');
      await account.refresh();
      await account.expectEnglish();
    });
  });
}
