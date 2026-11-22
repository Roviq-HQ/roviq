import '@testing-library/jest-dom/vitest';
import { zodValidator } from '@roviq/i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

type Reject = (form: Parameters<typeof setServerFieldError>[0]) => void;

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
        ? 'keeps the error and the disabled submit after the field is edited'
        : 'drops the error once the field is edited',
      async () => {
        await rejected((form) =>
          form.setFieldMeta('profile.code', (prev) => ({
            ...prev,
            isTouched: true,
            errorMap: { ...prev.errorMap, [slot]: 'Code already exists' },
          })),
        );

        await userEvent.type(screen.getByTestId('code'), '2');

        if (sticks) {
          expect(screen.getByTestId('code-error')).toBeInTheDocument();
          expect(screen.getByTestId('submit')).toBeDisabled();
        } else {
          await waitFor(() => expect(screen.queryByTestId('code-error')).not.toBeInTheDocument());
        }
      },
    );
  });
});
