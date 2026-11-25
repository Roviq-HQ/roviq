import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { testIds } from '../../testing/testid-registry';
import { clearFormSubmitError, setFormSubmitError } from '../submit-error';
import { useAppForm } from '../use-app-form';

type Form = Parameters<typeof setFormSubmitError>[0];

function Harness({
  onSubmit,
  onForm,
}: {
  onSubmit: (form: Form) => void | Promise<void>;
  onForm?: (form: Form) => void;
}) {
  const form = useAppForm({
    defaultValues: { name: '' },
    onSubmit: ({ formApi }) => onSubmit(formApi),
  });
  onForm?.(form);
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="name">{(f) => <f.TextField label="Name" testId="name" />}</form.AppField>
      <form.AppForm>
        <form.SubmitError />
        <form.SubmitButton testId="submit">Save</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}

const OFFLINE = { title: 'Could not reach the server', description: 'Nothing was saved.' };

const alert = () => screen.queryByTestId(testIds.form.submitError);

async function failOnce(onAccepted = vi.fn()) {
  let attempts = 0;
  let form: Form | undefined;
  render(
    <Harness
      onForm={(f) => {
        form = f;
      }}
      onSubmit={(f) => {
        attempts += 1;
        if (attempts === 1) {
          setFormSubmitError(f, OFFLINE);
          return;
        }
        onAccepted();
      }}
    />,
  );
  await userEvent.click(screen.getByTestId('submit'));
  await screen.findByTestId(testIds.form.submitError);
  if (!form) throw new Error('form not rendered');
  return { form, onAccepted };
}

describe('SubmitError', () => {
  it('should render nothing before a submit fails', () => {
    render(<Harness onSubmit={vi.fn()} />);

    expect(alert()).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should show the title and description as an alert after a failed submit', async () => {
    await failOnce();

    const shown = screen.getByRole('alert');
    expect(shown).toHaveAttribute('data-testid', testIds.form.submitError);
    expect(shown).toHaveTextContent('Could not reach the server');
    expect(shown).toHaveTextContent('Nothing was saved.');
  });

  it('should keep the alert while the person edits a field', async () => {
    await failOnce();

    await userEvent.type(screen.getByTestId('name'), 'Science club');

    expect(alert()).toHaveTextContent('Could not reach the server');
  });

  it('should leave Save enabled so the person can try again', async () => {
    await failOnce();

    await waitFor(() => expect(screen.getByTestId('submit')).toBeEnabled());
  });

  it('should clear the alert as soon as Save is pressed again', async () => {
    const { onAccepted } = await failOnce();

    await userEvent.click(screen.getByTestId('submit'));

    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(alert()).not.toBeInTheDocument();
  });

  it('should replace the first error when a second one is set', async () => {
    const { form } = await failOnce();

    act(() => setFormSubmitError(form, { title: 'You cannot create groups' }));

    await waitFor(() => expect(alert()).toHaveTextContent('You cannot create groups'));
    expect(alert()).not.toHaveTextContent('Could not reach the server');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('should remove the alert when cleared', async () => {
    const { form } = await failOnce();

    act(() => clearFormSubmitError(form));

    await waitFor(() => expect(alert()).not.toBeInTheDocument());
  });
});
