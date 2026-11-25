import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import enCommon from '../../../../../../apps/web/messages/en/common.json';
import hiCommon from '../../../../../../apps/web/messages/hi/common.json';
import { defineFieldHelp, type FormHelpMode, resolveHelpText } from '../help/field-help';
import { FormHelpModeProvider } from '../help/form-help-mode';
import { useAppForm } from '../use-app-form';

const help = defineFieldHelp('test.form', {
  code: {
    title: { en: 'Institute code', hi: 'संस्थान कोड' },
    hint: { en: 'Up to {max} letters.', hi: 'अधिकतम {max} अक्षर।' },
    body: { en: 'Printed on every receipt.', hi: 'हर रसीद पर छपता है।' },
    values: { max: 8 },
  },
});

function Harness({
  mode,
  locale = 'en',
  description,
}: {
  mode?: FormHelpMode;
  locale?: 'en' | 'hi';
  description?: string;
}) {
  const form = useAppForm({ defaultValues: { code: '' } });
  const field = (
    <form.AppField name="code">
      {(f) => <f.TextField label="Code" help={help.code} description={description} />}
    </form.AppField>
  );
  const withMode: ReactNode = mode ? (
    <FormHelpModeProvider mode={mode}>{field}</FormHelpModeProvider>
  ) : (
    field
  );
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ common: locale === 'en' ? enCommon : hiCommon }}
    >
      {withMode}
    </NextIntlClientProvider>
  );
}

describe('defineFieldHelp', () => {
  it('gives each topic a stable scoped id', () => {
    expect(help.code.id).toBe('test.form.code');
  });
});

describe('resolveHelpText', () => {
  it('picks the locale and fills values', () => {
    expect(resolveHelpText(help.code.hint ?? help.code.body, 'hi', { max: 8 })).toBe(
      'अधिकतम 8 अक्षर।',
    );
  });

  it('leaves an unknown placeholder as written', () => {
    expect(resolveHelpText({ en: 'Up to {n}', hi: '' }, 'en', { max: 8 })).toBe('Up to {n}');
  });
});

describe('TextField with help', () => {
  it('shows the hint by default and links hint and description to the input', () => {
    render(<Harness description="Letters only." />);
    const input = screen.getByRole('textbox', { name: 'Code' });
    expect(screen.getByText('Up to 8 letters.')).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription('Up to 8 letters. Letters only.');
  });

  it('hides the hint in ICON_ONLY mode but keeps the description', () => {
    render(<Harness mode="ICON_ONLY" description="Letters only." />);
    expect(screen.queryByText('Up to 8 letters.')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveAccessibleDescription(
      'Letters only.',
    );
  });

  it('opens the popover from a translated button named after the field', async () => {
    render(<Harness mode="ICON_ONLY" />);
    await userEvent.click(screen.getByRole('button', { name: 'More about Code' }));
    expect(await screen.findByText('Printed on every receipt.')).toBeInTheDocument();
  });

  it('renders Hindi copy for the Hindi locale', () => {
    render(<Harness locale="hi" />);
    expect(screen.getByText('अधिकतम 8 अक्षर।')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Code के बारे में और जानें' })).toBeInTheDocument();
  });
});
