import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { testIds } from '../../../testing/testid-registry';
import { LocaleSwitcher } from '../locale-switcher';

describe('LocaleSwitcher', () => {
  it('should hand the chosen locale to the app handler', async () => {
    const onLocaleChange = vi.fn();
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ locale: { switchLocale: 'Switch language' } }}
      >
        <LocaleSwitcher onLocaleChange={onLocaleChange} />
      </NextIntlClientProvider>,
    );

    await userEvent.click(screen.getByTestId(testIds.layout.localeSwitcher));
    await userEvent.click(await screen.findByTestId(testIds.layout.localeOption('hi')));

    expect(onLocaleChange).toHaveBeenCalledWith('hi');
  });
});
