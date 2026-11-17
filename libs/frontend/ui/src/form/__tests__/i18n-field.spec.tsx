import { InstituteLocalesProvider } from '@roviq/i18n';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nField } from '../fields/i18n-field';
import { useAppForm } from '../use-app-form';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

function ContentForm() {
  const form = useAppForm({
    defaultValues: { name: { en: 'Science', hi: 'विज्ञान', ta: 'அறிவியல்' } },
  });
  return <I18nField form={form} name="name" label="Name" />;
}

describe('I18nField institute languages', () => {
  it('renders configured languages and changes rows when the institute changes', () => {
    const { rerender } = render(
      <InstituteLocalesProvider value={{ supportedLocales: ['en', 'ta'], defaultLocale: 'ta' }}>
        <ContentForm />
      </InstituteLocalesProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Name (English)' })).toHaveValue('Science');
    expect(screen.getByRole('textbox', { name: 'Name (தமிழ்)' })).toHaveValue('அறிவியல்');
    expect(screen.queryByRole('textbox', { name: 'Name (हिन्दी)' })).not.toBeInTheDocument();
    rerender(
      <InstituteLocalesProvider value={{ supportedLocales: ['en', 'hi'], defaultLocale: 'en' }}>
        <ContentForm />
      </InstituteLocalesProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Name (हिन्दी)' })).toHaveValue('विज्ञान');
    expect(screen.queryByRole('textbox', { name: 'Name (தமிழ்)' })).not.toBeInTheDocument();
  });
});
