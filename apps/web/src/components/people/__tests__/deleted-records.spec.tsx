import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeletedRecordsButton, DeletePersonButton } from '../deleted-records';
import type { DeletedPerson } from '../use-deleted-records';

const state = vi.hoisted(() => ({
  people: [] as DeletedPerson[],
  loading: false,
  restore: vi.fn(),
  deletePerson: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../use-deleted-records', () => ({
  useDeletedPeople: () => ({
    data: state.loading ? undefined : { deleted: state.people },
    loading: state.loading,
    error: undefined,
    refetch: vi.fn(),
  }),
  useRestorePerson: () => [state.restore, { loading: false }],
  useDeletePerson: () => [state.deletePerson, { loading: false }],
}));

vi.mock('sonner', () => ({
  toast: { success: state.toastSuccess, error: state.toastError },
}));

const DELETED_STUDENT: DeletedPerson = {
  id: 'student-1',
  firstName: { en: 'Priya' },
  lastName: { en: 'Singh' },
  identifier: 'S-2026/0001',
  deletedAt: '2026-11-17T10:00:00.000Z',
};

function graphQLError(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: 'raw server text', extensions: { code } }],
  });
}

beforeEach(() => {
  state.people = [];
  state.loading = false;
  state.restore.mockReset().mockResolvedValue({ data: { done: true } });
  state.deletePerson.mockReset().mockResolvedValue({ data: { done: true } });
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
  // Desktop: the list opens in a Dialog.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

describe('DeletedRecordsButton', () => {
  it('should not render without the restore permission', () => {
    renderWithProviders(<DeletedRecordsButton kind="student" />, {
      abilityRules: [{ action: 'read', subject: 'Student' }],
    });

    expect(screen.queryByRole('button', { name: 'Deleted students' })).not.toBeInTheDocument();
  });

  it('should list deleted students with their admission number', async () => {
    state.people = [DELETED_STUDENT];
    renderWithProviders(<DeletedRecordsButton kind="student" />);

    await userEvent.click(screen.getByRole('button', { name: 'Deleted students' }));

    expect(await screen.findByText('Priya Singh')).toBeInTheDocument();
    expect(screen.getByText(/Admission no\. S-2026\/0001/)).toBeInTheDocument();
    expect(screen.getByText(/Deleted on 17\/11\/2026/)).toBeInTheDocument();
  });

  it('should show the empty state when nothing is deleted', async () => {
    renderWithProviders(<DeletedRecordsButton kind="guardian" />);

    await userEvent.click(screen.getByRole('button', { name: 'Deleted guardians' }));

    expect(await screen.findByText('No deleted guardians')).toBeInTheDocument();
  });

  it('should restore a record and confirm with a toast', async () => {
    state.people = [DELETED_STUDENT];
    renderWithProviders(<DeletedRecordsButton kind="student" />);
    await userEvent.click(screen.getByRole('button', { name: 'Deleted students' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));

    expect(state.restore).toHaveBeenCalledWith({ variables: { id: 'student-1' } });
    await waitFor(() => expect(state.toastSuccess).toHaveBeenCalledWith('Priya Singh restored'));
  });

  it('should explain a reissued admission number instead of showing the server text', async () => {
    state.people = [DELETED_STUDENT];
    state.restore.mockRejectedValue(graphQLError('ADMISSION_NUMBER_TAKEN'));
    renderWithProviders(<DeletedRecordsButton kind="student" />);
    await userEvent.click(screen.getByRole('button', { name: 'Deleted students' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));

    await waitFor(() =>
      expect(state.toastError).toHaveBeenCalledWith('Could not restore Priya Singh', {
        description:
          "The admission number is now used by another student. Change that student's admission number, then restore.",
        duration: Number.POSITIVE_INFINITY,
      }),
    );
  });
});

describe('DeletePersonButton', () => {
  it('should not render without the delete permission', () => {
    renderWithProviders(
      <DeletePersonButton kind="staff" id="staff-1" name="Asha Rao" onDeleted={vi.fn()} />,
      { abilityRules: [{ action: 'read', subject: 'Staff' }] },
    );

    expect(screen.queryByRole('button', { name: 'Delete staff member' })).not.toBeInTheDocument();
  });

  it('should state the consequence, delete on confirm, and offer Undo', async () => {
    const onDeleted = vi.fn();
    renderWithProviders(
      <DeletePersonButton kind="staff" id="staff-1" name="Asha Rao" onDeleted={onDeleted} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete staff member' }));
    expect(await screen.findByText(/today is recorded as the leaving date/)).toBeInTheDocument();
    expect(state.deletePerson).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(state.deletePerson).toHaveBeenCalledWith({ variables: { id: 'staff-1' } });
    const [message, options] = state.toastSuccess.mock.calls[0];
    expect(message).toBe('Asha Rao deleted');
    expect(options.action.label).toBe('Undo');

    await options.action.onClick();
    expect(state.restore).toHaveBeenCalledWith({ variables: { id: 'staff-1' } });
  });

  it('should keep the record and explain why when the delete is refused', async () => {
    const onDeleted = vi.fn();
    state.deletePerson.mockRejectedValue(graphQLError('HAS_ACTIVE_ENROLLMENTS'));
    renderWithProviders(
      <DeletePersonButton kind="student" id="student-1" name="Priya Singh" onDeleted={onDeleted} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete student' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(state.toastError).toHaveBeenCalledWith('Could not delete Priya Singh', {
        description:
          'This student is enrolled in the current academic year. Mark them as left or transferred first.',
        duration: Number.POSITIVE_INFINITY,
      }),
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('should explain that the only guardian of a student cannot be deleted', async () => {
    const onDeleted = vi.fn();
    state.deletePerson.mockRejectedValue(graphQLError('LAST_GUARDIAN_CANNOT_BE_DELETED'));
    renderWithProviders(
      <DeletePersonButton
        kind="guardian"
        id="guardian-1"
        name="Suresh Kumar"
        onDeleted={onDeleted}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete guardian' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(state.toastError).toHaveBeenCalledWith('Could not delete Suresh Kumar', {
        description:
          'This is the only guardian of a student. Link another guardian to that student first.',
        duration: Number.POSITIVE_INFINITY,
      }),
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('should show generic copy, never the server text, for an unmapped error code', async () => {
    state.deletePerson.mockRejectedValue(graphQLError('INTERNAL_ERROR'));
    renderWithProviders(
      <DeletePersonButton kind="staff" id="staff-1" name="Asha Rao" onDeleted={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete staff member' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(state.toastError).toHaveBeenCalledWith('Could not delete Asha Rao', {
        description: 'An unexpected error occurred. Please try again.',
        duration: Number.POSITIVE_INFINITY,
      }),
    );
  });
});
