import { expect, test } from './console-guardian';
import { LanguagePreferencePage } from './pages/LanguagePreferencePage';

export function languagePreferenceTests(portal: 'admin' | 'reseller' | 'institute') {
  test.describe('Account language preference', () => {
    let original: string | null | undefined;

    test.afterEach(async ({ page }) => {
      if (original !== undefined) {
        await new LanguagePreferencePage(page, portal).restorePreference(original);
      }
    });

    test('persists across refresh while allowing a temporary topbar override', async ({ page }) => {
      const account = new LanguagePreferencePage(page, portal);
      await account.goto();
      original = await account.readPreference();
      await account.select('hi');
      await account.expectHindi();
      expect(await account.readPreference()).toBe('hi');
      await account.refresh();
      await account.expectHindi();
      await account.temporarilyUseEnglish();
      expect(await account.readPreference()).toBe('hi');
      await account.refresh();
      await account.expectHindi();
      await account.select('browser');
      await expect.poll(() => account.readPreference()).toBeNull();
    });
  });
}
