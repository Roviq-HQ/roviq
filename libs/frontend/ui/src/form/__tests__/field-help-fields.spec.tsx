import '@testing-library/jest-dom/vitest';
import { InstituteLocalesProvider } from '@roviq/i18n';
import { FieldInfoPopover } from '@roviq/ui/components/ui/field-info-popover';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import enCommon from '../../../../../../apps/web/messages/en/common.json';
import { I18nField } from '../fields/i18n-field';
import { defineFieldHelp, type FormHelpMode, type HelpArticle } from '../help/field-help';
import { FieldHelpButton } from '../help/field-help-button';
import { FormHelpModeProvider } from '../help/form-help-mode';
import { useAppForm } from '../use-app-form';

const article: HelpArticle = {
  title: { en: 'Session dates in full', hi: 'सत्र तिथियाँ' },
  sections: [
    {
      heading: { en: 'Years cannot overlap', hi: 'ओवरलैप नहीं' },
      warning: { en: 'Overlapping years are refused.', hi: 'ओवरलैप वर्ष अस्वीकार।' },
      steps: [{ en: 'Start the next year the day after.', hi: 'अगले दिन से शुरू करें।' }],
    },
  ],
};

const help = defineFieldHelp('test.fields', {
  value: {
    title: { en: 'Value', hi: 'मान' },
    hint: { en: 'A short hint.', hi: 'छोटा संकेत।' },
    body: { en: 'What the value changes.', hi: 'मान क्या बदलता है।' },
  },
  plan: {
    title: { en: 'Plan', hi: 'योजना' },
    body: { en: 'Which plan applies.', hi: 'कौन सी योजना।' },
    options: {
      BASIC: { en: 'Ten users at most.', hi: 'अधिकतम दस उपयोगकर्ता।' },
    },
  },
  dates: {
    title: { en: 'Dates', hi: 'तिथियाँ' },
    body: { en: 'The session dates.', hi: 'सत्र तिथियाँ।' },
    article: () => Promise.resolve(article),
  },
  broken: {
    title: { en: 'Broken', hi: 'टूटा' },
    body: { en: 'Its article fails to load.', hi: 'लेख लोड नहीं होता।' },
    article: () => Promise.reject(new Error('chunk failed')),
  },
});

type Kind = 'textarea' | 'number' | 'money' | 'phone' | 'date' | 'select' | 'checkbox' | 'switch';

const DEFAULTS: Record<Kind, unknown> = {
  textarea: '',
  number: undefined,
  money: undefined,
  phone: '',
  date: '',
  select: undefined,
  checkbox: false,
  switch: false,
};

function Providers({ mode, children }: { mode: FormHelpMode; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <FormHelpModeProvider mode={mode}>{children}</FormHelpModeProvider>
    </NextIntlClientProvider>
  );
}

function KindForm({ kind }: { kind: Kind }) {
  const form = useAppForm({ defaultValues: { v: DEFAULTS[kind] } });
  const common = { label: 'Value', description: 'Instruction.', help: help.value };
  return (
    <form.AppField name="v" validators={{ onBlur: () => 'Bad value' }}>
      {(f) => {
        switch (kind) {
          case 'textarea':
            return <f.TextareaField {...common} />;
          case 'number':
            return <f.NumberField {...common} />;
          case 'money':
            return <f.MoneyField {...common} showFormattedPreview={false} />;
          case 'phone':
            return <f.PhoneField {...common} />;
          case 'date':
            return <f.DateField {...common} />;
          case 'select':
            return <f.SelectField {...common} options={[{ value: 'A', label: 'A' }]} />;
          case 'checkbox':
            return <f.CheckboxField {...common} />;
          case 'switch':
            return <f.SwitchField {...common} />;
        }
      }}
    </form.AppField>
  );
}

const KINDS: Kind[] = [
  'textarea',
  'number',
  'money',
  'phone',
  'date',
  'select',
  'checkbox',
  'switch',
];

describe.each(KINDS)('%s field with help', (kind) => {
  it('should show the hint and describe the control by hint and instruction', () => {
    render(
      <Providers mode="ICON_AND_HINT">
        <KindForm kind={kind} />
      </Providers>,
    );
    const control = screen.getByLabelText('Value');
    expect(screen.getByText('A short hint.')).toBeInTheDocument();
    expect(control).toHaveAccessibleDescription('A short hint. Instruction.');
  });

  it('should hide the hint in ICON_ONLY mode and keep the instruction', () => {
    render(
      <Providers mode="ICON_ONLY">
        <KindForm kind={kind} />
      </Providers>,
    );
    expect(screen.queryByText('A short hint.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Value')).toHaveAccessibleDescription('Instruction.');
  });

  it('should add the error to the description after the field is left invalid', async () => {
    render(
      <Providers mode="ICON_ONLY">
        <KindForm kind={kind} />
      </Providers>,
    );
    fireEvent.focusOut(screen.getByLabelText('Value'));
    await screen.findByText('Bad value');
    expect(screen.getByLabelText('Value')).toHaveAccessibleDescription('Instruction. Bad value');
  });

  it('should name the help button after the field', () => {
    render(
      <Providers mode="ICON_ONLY">
        <KindForm kind={kind} />
      </Providers>,
    );
    expect(screen.getByRole('button', { name: 'More about Value' })).toBeInTheDocument();
  });
});

function I18nForm({ mode }: { mode: FormHelpMode }) {
  const form = useAppForm({ defaultValues: { name: { en: '', hi: '' } } });
  return (
    <Providers mode={mode}>
      <InstituteLocalesProvider value={{ supportedLocales: ['en', 'hi'], defaultLocale: 'en' }}>
        <I18nField
          form={form}
          name="name"
          label="Name"
          description="Instruction."
          help={help.value}
        />
      </InstituteLocalesProvider>
    </Providers>
  );
}

describe('I18nField with help', () => {
  it('should put the help button beside the legend and describe every row by hint and instruction', () => {
    render(<I18nForm mode="ICON_AND_HINT" />);
    expect(screen.getByRole('button', { name: 'More about Name' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name (English)' })).toHaveAccessibleDescription(
      'A short hint. Instruction.',
    );
    expect(screen.getByRole('textbox', { name: 'Name (हिन्दी)' })).toHaveAccessibleDescription(
      'A short hint. Instruction.',
    );
  });

  it('should hide the hint in ICON_ONLY mode', () => {
    render(<I18nForm mode="ICON_ONLY" />);
    expect(screen.queryByText('A short hint.')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name (English)' })).toHaveAccessibleDescription(
      'Instruction.',
    );
  });
});

function PlanForm() {
  const form = useAppForm({ defaultValues: { plan: undefined as string | undefined } });
  return (
    <form.AppField name="plan">
      {(f) => (
        <f.SelectField
          label="Plan"
          help={help.plan}
          options={[
            { value: 'BASIC', label: 'Basic' },
            { value: 'PRO', label: 'Pro' },
          ]}
        />
      )}
    </form.AppField>
  );
}

describe('SelectField with option help', () => {
  it('should show the option help as a second line under that choice only', async () => {
    // Radix Select calls these browser APIs that jsdom lacks.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.scrollIntoView = vi.fn();
    const user = userEvent.setup();
    render(
      <Providers mode="ICON_ONLY">
        <PlanForm />
      </Providers>,
    );
    await user.click(screen.getByRole('combobox', { name: 'Plan' }));
    const basic = await screen.findByRole('option', { name: /Basic/ });
    expect(basic).toHaveTextContent('BasicTen users at most.');
    expect(screen.getByRole('option', { name: 'Pro' })).toHaveTextContent(/^Pro$/);
  });
});

describe('FieldHelpButton', () => {
  it('should list option help under the real option labels', async () => {
    render(
      <Providers mode="ICON_ONLY">
        <FieldHelpButton topic={help.plan} fieldLabel="Plan" optionLabels={{ BASIC: 'Basic' }} />
      </Providers>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More about Plan' }));
    expect(await screen.findByText('Basic')).toBeInTheDocument();
    expect(screen.getByText(/Ten users at most\./)).toBeInTheDocument();
  });

  it('should load the article on Read more and return focus to the button on close', async () => {
    const user = userEvent.setup();
    render(
      <Providers mode="ICON_ONLY">
        <FieldHelpButton topic={help.dates} fieldLabel="Dates" />
      </Providers>,
    );
    const trigger = screen.getByRole('button', { name: 'More about Dates' });
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Read more' }));
    expect(
      await screen.findByRole('heading', { name: 'Session dates in full' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Overlapping years are refused.');
    expect(screen.getByText('Start the next year the day after.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('should show an error with Try again when the article fails to load', async () => {
    const user = userEvent.setup();
    render(
      <Providers mode="ICON_ONLY">
        <FieldHelpButton topic={help.broken} fieldLabel="Broken" />
      </Providers>,
    );
    await user.click(screen.getByRole('button', { name: 'More about Broken' }));
    await user.click(await screen.findByRole('button', { name: 'Read more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This help could not be loaded. Check your connection and try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('FieldInfoPopover', () => {
  it('should close on Escape', async () => {
    const user = userEvent.setup();
    render(<FieldInfoPopover title="Code">Body text.</FieldInfoPopover>);
    await user.click(screen.getByRole('button', { name: 'More info' }));
    expect(await screen.findByText('Body text.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Body text.')).not.toBeInTheDocument());
  });

  it('should stay open after a click when the cursor leaves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<FieldInfoPopover title="Code">Body text.</FieldInfoPopover>);
      const trigger = screen.getByRole('button', { name: 'More info' });
      await user.hover(trigger);
      await user.click(trigger);
      await screen.findByText('Body text.');
      await user.unhover(trigger);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('Body text.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should close after the cursor leaves when it was opened by hover', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<FieldInfoPopover title="Code">Body text.</FieldInfoPopover>);
      const trigger = screen.getByRole('button', { name: 'More info' });
      await user.hover(trigger);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      await screen.findByText('Body text.');
      await user.unhover(trigger);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      await waitFor(() => expect(screen.queryByText('Body text.')).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('should open by keyboard', async () => {
    const user = userEvent.setup();
    render(<FieldInfoPopover title="Code">Body text.</FieldInfoPopover>);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Body text.')).toBeInTheDocument();
  });
});
