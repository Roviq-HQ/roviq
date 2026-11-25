import '@testing-library/jest-dom/vitest';
import { zodValidator } from '@roviq/i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { setServerFieldError } from '../server-field-error';
import { useAppForm } from '../use-app-form';

const schema = z.object({ profile: z.object({ code: z.string().min(1) }), other: z.string() });

const configs = [
  {
    name: 'form-level onChange and onSubmit validators',
    validators: { onChange: zodValidator(schema), onSubmit: zodValidator(schema) },
  },
  { name: 'form-level onSubmit validator only', validators: { onSubmit: zodValidator(schema) } },
  { name: 'no validators', validators: undefined },
  { name: 'field-level validators only', validators: undefined, fieldValidators: true },
] as const;

type Form = Parameters<typeof setServerFieldError>[0];
type Reject = (form: Form) => void;

function Harness({
  validators,
  fieldValidators,
  reject,
  onAccepted,
}: {
  validators: (typeof configs)[number]['validators'];
  fieldValidators?: boolean;
  reject: Reject;
  onAccepted: (code: string) => void;
}) {
  const form = useAppForm({
    defaultValues: { profile: { code: 'TAKEN' }, other: '' },
    validators,
    onSubmit: ({ value }) => {
      if (value.profile.code === 'TAKEN') {
        reject(form);
        return;
      }
      onAccepted(value.profile.code);
    },
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField
        name="profile.code"
        validators={
          fieldValidators
            ? { onChange: ({ value }) => (value.length > 0 ? undefined : 'required') }
            : undefined
        }
      >
        {(f) => <f.TextField label="Code" testId="code" errorTestId="code-error" />}
      </form.AppField>
      <form.AppField name="other">
        {(f) => <f.TextField label="Other" testId="other" />}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton testId="submit">Save</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}

describe.each(configs)('$name', (config) => {
  const fieldValidators = 'fieldValidators' in config;

  async function rejected(reject: Reject, onAccepted = vi.fn()) {
    render(
      <Harness
        validators={config.validators}
        fieldValidators={fieldValidators}
        reject={reject}
        onAccepted={onAccepted}
      />,
    );
    await userEvent.click(screen.getByTestId('submit'));
    await screen.findByTestId('code-error');
    return onAccepted;
  }

  const helper: Reject = (form) => setServerFieldError(form, 'profile.code', 'Code already exists');

  describe('setServerFieldError', () => {
    it('shows the message under the field and marks it invalid', async () => {
      await rejected(helper);

      expect(screen.getByTestId('code-error')).toHaveTextContent('Code already exists');
      expect(screen.getByTestId('code')).toHaveAttribute('aria-invalid', 'true');
    });

    it('keeps the message while a different field is edited', async () => {
      await rejected(helper);

      await userEvent.type(screen.getByTestId('other'), 'x');

      expect(screen.getByTestId('code-error')).toBeInTheDocument();
    });

    it('clears the message on the next edit of the field and lets the corrected value submit', async () => {
      const onAccepted = await rejected(helper);

      await userEvent.type(screen.getByTestId('code'), '2');

      await waitFor(() => expect(screen.queryByTestId('code-error')).not.toBeInTheDocument());
      expect(screen.getByTestId('code')).not.toHaveAttribute('aria-invalid');
      expect(screen.getByTestId('submit')).toBeEnabled();
      await userEvent.click(screen.getByTestId('submit'));
      await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('TAKEN2'));
    });

    it('shows a fresh rejection after the field was edited back to the rejected value', async () => {
      await rejected(helper);
      const input = screen.getByTestId('code');

      await userEvent.type(input, '2');
      await waitFor(() => expect(screen.queryByTestId('code-error')).not.toBeInTheDocument());
      await userEvent.type(input, '{Backspace}');
      await userEvent.click(screen.getByTestId('submit'));

      expect(await screen.findByTestId('code-error')).toHaveTextContent('Code already exists');
    });
  });

  // Why the helper exists: the onChange slot is never cleared by the form's own validators.
  describe.each(['onChange', 'onSubmit'] as const)('raw setFieldMeta on the %s slot', (slot) => {
    const sticks = slot === 'onChange' && !fieldValidators;

    it(
      sticks
        ? 'keeps the error and refuses every submit after the field is edited'
        : 'drops the error once the field is edited',
      async () => {
        const onAccepted = await rejected((form) =>
          form.setFieldMeta('profile.code', (prev) => ({
            ...prev,
            isTouched: true,
            errorMap: { ...prev.errorMap, [slot]: 'Code already exists' },
          })),
        );

        await userEvent.type(screen.getByTestId('code'), '2');

        if (sticks) {
          expect(screen.getByTestId('code-error')).toBeInTheDocument();
          await userEvent.click(screen.getByTestId('submit'));
          expect(screen.getByTestId('code-error')).toBeInTheDocument();
          expect(onAccepted).not.toHaveBeenCalled();
        } else {
          await waitFor(() => expect(screen.queryByTestId('code-error')).not.toBeInTheDocument());
        }
      },
    );
  });
});

describe('setServerFieldError with both form objects', () => {
  // `useAppForm` returns a copy of the FormApi that `onSubmit` receives as `formApi`.
  function TwoHandles({ onForms }: { onForms: (form: Form, formApi: Form) => void }) {
    const form = useAppForm({
      defaultValues: { profile: { code: 'TAKEN' }, other: '' },
      onSubmit: ({ formApi }) => onForms(form, formApi),
    });
    return (
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="profile.code">
          {(f) => <f.TextField label="Code" testId="code" errorTestId="code-error" />}
        </form.AppField>
        <form.AppField name="other">
          {(f) => <f.TextField label="Other" testId="other" />}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton testId="submit">Save</form.SubmitButton>
        </form.AppForm>
      </form>
    );
  }

  it('should replace a rejection set through formApi with one set through the form', async () => {
    render(
      <TwoHandles
        onForms={(form, formApi) => {
          setServerFieldError(formApi, 'profile.code', 'Code already exists', {
            alsoClearOnChangeOf: ['other'],
          });
          setServerFieldError(form, 'profile.code', 'Code already exists');
        }}
      />,
    );
    await userEvent.click(screen.getByTestId('submit'));
    await screen.findByTestId('code-error');

    await userEvent.type(screen.getByTestId('other'), 'x');

    expect(screen.getByTestId('code-error')).toHaveTextContent('Code already exists');
  });
});

function StepHarness() {
  const [step, setStep] = useState<'code' | 'review'>('code');
  const form = useAppForm({
    defaultValues: { code: 'TAKEN' },
    onSubmit: ({ formApi }) => {
      setServerFieldError(formApi, 'code', 'Code already in use');
      setStep('code');
    },
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      {step === 'code' ? (
        <form.AppField name="code">{(field) => <field.TextField label="Code" />}</form.AppField>
      ) : (
        <p>Review</p>
      )}
      <button type="button" onClick={() => setStep(step === 'code' ? 'review' : 'code')}>
        Switch step
      </button>
      <button type="submit">Save</button>
    </form>
  );
}

describe('setServerFieldError on a field that is not mounted', () => {
  it.each([
    { mode: 'plain', strict: false },
    { mode: 'React StrictMode', strict: true },
  ])('should show the rejection when the step with the field opens ($mode)', async ({ strict }) => {
    render(
      strict ? (
        <StrictMode>
          <StepHarness />
        </StrictMode>
      ) : (
        <StepHarness />
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Switch step' }));
    expect(screen.getByText('Review')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Code already in use')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Code/ })).toHaveAttribute('aria-invalid', 'true');
  });

  it('should keep the rejection when the person leaves the step and comes back', async () => {
    render(<StepHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Code already in use');

    await userEvent.click(screen.getByRole('button', { name: 'Switch step' }));
    await userEvent.click(screen.getByRole('button', { name: 'Switch step' }));

    expect(await screen.findByText('Code already in use')).toBeInTheDocument();
  });

  it('should clear the rejection when the value changes after coming back', async () => {
    render(<StepHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Code already in use');

    await userEvent.type(screen.getByRole('textbox', { name: /Code/ }), 'X');

    await waitFor(() => expect(screen.queryByText('Code already in use')).not.toBeInTheDocument());
  });
});
