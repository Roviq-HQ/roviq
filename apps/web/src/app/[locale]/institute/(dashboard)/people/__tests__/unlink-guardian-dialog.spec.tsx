import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import peopleLinksEn from '@web-messages/en/peopleLinks.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { unlinkMock, toastSuccess, toastError, guardiansRef } = vi.hoisted(() => ({
  unlinkMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  guardiansRef: {
    current: [] as Array<{
      linkId: string;
      guardianProfileId: string;
      firstName: { en: string };
      lastName: { en: string };
      isPrimaryContact: boolean;
    }>,
  },
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('../guardians/use-guardians', () => ({
  useUnlinkGuardianFromStudent: () => [unlinkMock, { loading: false }],
}));
vi.mock('../students/use-students', () => ({
  useStudentGuardians: () => ({
    data: { listStudentGuardians: guardiansRef.current },
    loading: false,
  }),
}));

import { UnlinkGuardianButton } from '../unlink-guardian-dialog';

const FATHER = {
  linkId: 'link-f',
  guardianProfileId: 'g-father',
  firstName: { en: 'Rohit' },
  lastName: { en: 'Mehta' },
  isPrimaryContact: true,
};
const MOTHER = {
  linkId: 'link-m',
  guardianProfileId: 'g-mother',
  firstName: { en: 'Kavita' },
  lastName: { en: 'Mehta' },
  isPrimaryContact: false,
};
const names = { guardian: 'Rohit Mehta', student: 'Aarav Mehta' };

function renderButton(guardianProfileId = FATHER.guardianProfileId, guardian = names.guardian) {
  return renderWithProviders(
    <UnlinkGuardianButton
      linkId="link-x"
      studentProfileId="s-1"
      guardianProfileId={guardianProfileId}
      studentName={names.student}
      guardianName={guardian}
    />,
  );
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('guardian-unlink-btn-link-x'));
  await screen.findByTestId('guardian-unlink-dialog');
  return user;
}

describe('UnlinkGuardianButton', () => {
  beforeEach(() => {
    unlinkMock.mockReset();
    unlinkMock.mockResolvedValue({ data: { unlinkGuardianFromStudent: true } });
    toastSuccess.mockReset();
    toastError.mockReset();
    guardiansRef.current = [FATHER, MOTHER];
  });

  it('should require a new primary contact before unlinking the primary guardian', async () => {
    renderButton();
    const user = await openDialog();
    const confirm = screen.getByTestId('guardian-unlink-confirm-btn');

    expect(confirm).toBeDisabled();
    await user.click(screen.getByTestId('guardian-unlink-replacement-select'));
    await user.click(await screen.findByRole('option', { name: 'Kavita Mehta' }));
    await user.click(confirm);

    await waitFor(() => {
      expect(unlinkMock).toHaveBeenCalledWith({
        variables: {
          input: {
            guardianProfileId: 'g-father',
            studentProfileId: 's-1',
            newPrimaryGuardianId: 'g-mother',
          },
        },
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith('Rohit Mehta unlinked from Aarav Mehta');
  });

  it('should unlink a non-primary guardian without asking for a replacement', async () => {
    renderButton(MOTHER.guardianProfileId, 'Kavita Mehta');
    const user = await openDialog();

    expect(screen.queryByTestId('guardian-unlink-replacement-select')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('guardian-unlink-confirm-btn'));

    await waitFor(() => {
      expect(unlinkMock).toHaveBeenCalledWith({
        variables: { input: { guardianProfileId: 'g-mother', studentProfileId: 's-1' } },
      });
    });
  });

  it('should block unlinking the only guardian', async () => {
    guardiansRef.current = [FATHER];
    renderButton();
    await openDialog();

    expect(screen.getByTestId('guardian-unlink-last-guardian-notice')).toHaveTextContent(
      'Rohit Mehta is the only guardian of Aarav Mehta',
    );
    expect(screen.getByTestId('guardian-unlink-confirm-btn')).toBeDisabled();
  });

  it('should show translated copy for a known error code and keep the dialog open', async () => {
    unlinkMock.mockRejectedValueOnce(
      new CombinedGraphQLErrors({
        errors: [
          { message: 'raw server text', extensions: { code: 'LAST_GUARDIAN_CANNOT_BE_DELETED' } },
        ],
      }),
    );
    renderButton(MOTHER.guardianProfileId, 'Kavita Mehta');
    const user = await openDialog();

    await user.click(screen.getByTestId('guardian-unlink-confirm-btn'));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Couldn't unlink Kavita Mehta", {
        description: peopleLinksEn.unlink.errors.LAST_GUARDIAN_CANNOT_BE_DELETED.replace(
          '{student}',
          'Aarav Mehta',
        ),
        duration: Number.POSITIVE_INFINITY,
      });
    });
    expect(screen.getByTestId('guardian-unlink-dialog')).toBeInTheDocument();
  });

  it('should hide the button for roles that cannot update guardians', () => {
    renderWithProviders(
      <UnlinkGuardianButton
        linkId="link-x"
        studentProfileId="s-1"
        guardianProfileId="g-father"
        studentName={names.student}
        guardianName={names.guardian}
      />,
      { abilityRules: [{ action: 'read', subject: 'Guardian' }] },
    );

    expect(screen.queryByTestId('guardian-unlink-btn-link-x')).not.toBeInTheDocument();
  });
});
