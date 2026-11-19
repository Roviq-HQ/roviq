/**
 * ROV-186 — Reseller settings, Playwright UI E2E (reseller portal).
 *
 * The seeded reseller user is a full admin of the system reseller Roviq Direct,
 * whose name is fixed. Each test that saves puts the value back, so the seeded
 * record ends as it started.
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import sharp from 'sharp';
import { expect, test } from '../../shared/console-guardian';
import { SEED } from '../../shared/seed-fixtures';

const { resellerSettings, fileUpload } = testIds;

const SAVED = 'Changes saved';

test.describe('ROV-186 reseller — settings', () => {
  // Two tests save the same reseller row; in parallel one would lose the version race.
  test.describe.configure({ mode: 'serial' });

  test('opens on the profile section and moves between the four sections', async ({ page }) => {
    await page.goto('/en/reseller/settings');
    await expect(page.getByTestId(resellerSettings.profileForm)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByTestId(resellerSettings.tab('profile'))).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.getByTestId(resellerSettings.tab('branding')).click();
    await expect(page.getByTestId(resellerSettings.brandingForm)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/branding$/);

    await page.getByTestId(resellerSettings.tab('customDomain')).click();
    await expect(page.getByTestId(resellerSettings.customDomainNotice)).toBeVisible();

    await page.getByTestId(resellerSettings.tab('sessions')).click();
    await expect(page).toHaveURL(/\/settings\/sessions$/);
    await expect(page.getByTestId(resellerSettings.tab('sessions'))).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'Active Sessions' })).toBeVisible();
  });

  test('shows the fixed identity of the system reseller', async ({ page }) => {
    await page.goto('/en/reseller/settings/profile');
    const name = page.getByTestId('reseller-settings-name-input');
    await expect(name).toHaveValue(SEED.RESELLER.name, { timeout: 15_000 });
    await expect(name).toBeDisabled();
    await expect(page.getByTestId(resellerSettings.profileSlug)).toHaveText('roviq-direct');
    await expect(page.getByTestId(resellerSettings.profileTier)).toHaveText('Full Management');
    await expect(page.getByTestId(resellerSettings.profileStatus)).toHaveText('Active');
    await expect(page.getByTestId('reseller-settings-profile-save-btn')).toBeDisabled();
  });

  test('saves the registration number and keeps it after a reload', async ({ page }) => {
    await page.goto('/en/reseller/settings/profile');
    const registration = page.getByTestId('reseller-settings-registration-number-input');
    await expect(registration).toBeVisible({ timeout: 15_000 });
    const before = await registration.inputValue();
    const value = `UI-${Date.now().toString(36).toUpperCase()}`;
    const save = page.getByTestId('reseller-settings-profile-save-btn');

    await registration.fill(value);
    await save.click();
    await expect(page.getByText(SAVED).first()).toBeVisible();
    await expect(save).toBeDisabled();

    await page.reload();
    await expect(registration).toHaveValue(value, { timeout: 15_000 });

    await registration.fill(before);
    await save.click();
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(registration).toHaveValue(before, { timeout: 15_000 });
  });

  test('previews a colour live, saves it, and returns it to the default', async ({ page }) => {
    await page.goto('/en/reseller/settings/branding');
    const primary = page.getByTestId('reseller-settings-primary-color-input');
    await expect(primary).toBeVisible({ timeout: 15_000 });
    const before = await primary.inputValue();

    const preview = page.getByTestId(resellerSettings.brandingPreview);
    await expect(preview).toHaveAttribute('sandbox', '');
    const header = preview.contentFrame().locator('.brand-header');
    const save = page.getByTestId('reseller-settings-branding-save-btn');

    await primary.fill('#7C3AED');
    await expect(header).toHaveCSS('background-color', 'rgb(124, 58, 237)');
    await expect(header).toContainText(SEED.RESELLER.name);
    await save.click();
    await expect(page.getByText(SAVED).first()).toBeVisible();
    await expect(save).toBeDisabled();

    await page.reload();
    await expect(primary).toHaveValue('#7C3AED', { timeout: 15_000 });
    await expect(header).toHaveCSS('background-color', 'rgb(124, 58, 237)');

    await primary.fill(before);
    await save.click();
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(primary).toHaveValue(before, { timeout: 15_000 });
  });

  test('uploads a logo, shows it in the preview, keeps it after a reload, then removes it', async ({
    page,
  }) => {
    const logo = await sharp({
      create: { width: 600, height: 200, channels: 3, background: { r: 15, g: 118, b: 110 } },
    })
      .png()
      .toBuffer();

    await page.goto('/en/reseller/settings/branding');
    await expect(page.getByTestId(resellerSettings.brandingForm)).toBeVisible({ timeout: 15_000 });
    const save = page.getByTestId('reseller-settings-branding-save-btn');
    const stored = page.getByTestId(resellerSettings.brandingCurrentImage('logo'));
    const previewLogo = page
      .getByTestId(resellerSettings.brandingPreview)
      .contentFrame()
      .locator('.brand-logo-image');

    await page
      .getByTestId(fileUpload.input('reseller-logo'))
      .setInputFiles({ name: 'e2e-logo.png', mimeType: 'image/png', buffer: logo });
    await expect(page.getByTestId(fileUpload.item('e2e-logo.png'))).toHaveAttribute(
      'data-status',
      'done',
      { timeout: 20_000 },
    );
    await save.click();
    await expect(stored.locator('img')).toHaveAttribute('src', /reseller-logo\/.+\/md\.webp$/, {
      timeout: 20_000,
    });
    await expect(previewLogo).toBeVisible();
    await expect(save).toBeDisabled();

    await page.reload();
    await expect(stored).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(resellerSettings.brandingRemoveImageBtn('logo')).click();
    await expect(previewLogo).toHaveCount(0);
    await save.click();
    await expect(stored).toHaveCount(0);
    await expect(save).toBeDisabled();
  });

  test('refuses a file that is not an accepted image type before uploading anything', async ({
    page,
  }) => {
    await page.goto('/en/reseller/settings/branding');
    await expect(page.getByTestId(resellerSettings.brandingForm)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(fileUpload.input('reseller-favicon')).setInputFiles({
      name: 'icon.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('GIF89a'),
    });

    await expect(page.getByTestId(fileUpload.itemError('icon.gif'))).toHaveText(
      'This file type is not accepted here.',
    );
    await expect(page.getByTestId('reseller-settings-branding-save-btn')).toBeDisabled();
  });

  test('refuses a stylesheet that loads a remote file, before anything is sent', async ({
    page,
  }) => {
    await page.goto('/en/reseller/settings/branding');
    await expect(page.getByTestId(resellerSettings.brandingForm)).toBeVisible({ timeout: 15_000 });
    const advanced = page.getByTestId(resellerSettings.brandingAdvanced);
    const css = page.getByTestId('reseller-settings-custom-css-input');
    if (!(await css.isVisible())) await advanced.locator('summary').click();
    const before = await css.inputValue();

    await css.fill('.brand-header { background: url(https://example.com/x.png); }');
    await expect(page.getByTestId('reseller-settings-custom-css-error')).toContainText(
      'Remove "url(".',
    );
    await expect(page.getByTestId('reseller-settings-branding-save-btn')).toBeDisabled();

    await css.fill('.brand-header { letter-spacing: 6px; }');
    await expect(
      page.getByTestId(resellerSettings.brandingPreview).contentFrame().locator('.brand-header'),
    ).toHaveCSS('letter-spacing', '6px');

    // Leave the form as it was so the unsaved-changes prompt does not fire on teardown.
    await css.fill(before);
  });

  test('explains that a custom domain is not available yet', async ({ page }) => {
    await page.goto('/en/reseller/settings/custom-domain');
    await expect(page.getByTestId(resellerSettings.customDomainNotice)).toHaveText(
      'Custom domain support is coming soon.',
      { timeout: 15_000 },
    );
    await expect(page.getByTestId(resellerSettings.customDomainCurrentUrl)).toHaveText(
      new URL(page.url()).host,
    );
    await expect(page.getByTestId(resellerSettings.customDomainInput)).toBeDisabled();
    await expect(page.getByTestId(resellerSettings.customDomainSupportLink)).toHaveAttribute(
      'href',
      /^mailto:/,
    );
  });
});
