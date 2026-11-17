import { instituteLocaleLabels } from '@roviq/common-types';
import { test } from '../../shared/console-guardian';
import { InstituteLocalesPage } from '../../shared/pages/InstituteLocalesPage';
import { SEED } from '../../shared/seed-fixtures';

test('institute languages persist and drive translated inputs without changing interface languages', async ({
  page,
}) => {
  const settings = new InstituteLocalesPage(page);
  await settings.goto();
  const original = await settings.currentSettings();
  try {
    await settings.enableTamil();
    await settings.expectTamilAfterRefresh();
    await settings.expectTamilFormAndValidation();
    await settings.expectInterfaceLanguagesUnchanged();
    await settings.switchTo(SEED.INSTITUTE_2.id);
    const other = await settings.currentSettings();
    await settings.expectDefaultLanguage(instituteLocaleLabels[other.defaultLocale]);
    await settings.switchTo(original.id);
    await settings.expectDefaultLanguage('தமிழ்');
  } finally {
    await settings.switchTo(original.id);
    await settings.restore(original);
  }
});
