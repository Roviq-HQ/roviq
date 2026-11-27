import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import peopleLinksEn from '@web-messages/en/peopleLinks.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { revokeMock, restoreMock, toastSuccess } = vi.hoisted(() => ({
  revokeMock: vi.fn(),
  restoreMock: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('../guardians/use-guardians', () => ({
  useRevokeGuardianAccess: () => [revokeMock, { loading: false }],
  useRestoreGuardianAccess: () => [restoreMock, { loading: false }],
}));

import { GuardianAccessButton } from '../guardian-access-dialog';

const { institutePeople } = testIds;
const copy = peopleLinksEn.access;
const names = { guardian: 'Rohit Mehta', student: 'Aarav Mehta' };
const VARIABLES = {
  variables: { input: { guardianProfileId: 'g-father', studentProfileId: 's-1' } },
};

function fill(template: string) {
  return template.replaceAll('{guardian}', names.guardian).replaceAll('{student}', names.student);
}

function codeError(code: string) {
  return new CombinedGraphQLErrors({ errors: [{ message: 'refused', extensions: { code } }] });
}

function renderButton(revoked: boolean, abilityRules?: { action: string; subject: string }[]) {
  return renderWithProviders(
    <GuardianAccessButton
      linkId="link-x"
      studentProfileId="s-1"
      guardianProfileId="g-father"
      studentName={names.student}
      guardianName={names.guardian}
      revoked={revoked}
    />,
    abilityRules ? { abilityRules } : undefined,
  );
}

describe('GuardianAccessButton', () => {
  beforeEach(() => {
    revokeMock.mockReset();
    revokeMock.mockResolvedValue({ data: {} });
    restoreMock.mockReset();
    restoreMock.mockResolvedValue({ data: {} });
    toastSuccess.mockReset();
  });

  it('should hide the button from a role that cannot manage guardians', () => {
    renderButton(false, [
      { action: 'read', subject: 'Guardian' },
      { action: 'update', subject: 'Guardian' },
    ]);

    expect(screen.queryByTestId(institutePeople.accessRevokeBtn('link-x'))).toBeNull();
  });

  it('should say what the guardian loses, then revoke and close', async () => {
    renderButton(false);
    const user = userEvent.setup();
    await user.click(screen.getByTestId(institutePeople.accessRevokeBtn('link-x')));
    const dialog = await screen.findByTestId(institutePeople.accessDialog);

    expect(dialog).toHaveTextContent(fill(copy.revoke.consequence));
    await user.click(screen.getByTestId(institutePeople.accessConfirmBtn));

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith(VARIABLES));
    expect(restoreMock).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(fill(copy.revoke.success));
    await waitFor(() => expect(screen.queryByTestId(institutePeople.accessDialog)).toBeNull());
  });

  it('should offer restore for a revoked guardian and say what is not given back', async () => {
    renderButton(true);
    const user = userEvent.setup();

    expect(screen.queryByTestId(institutePeople.accessRevokeBtn('link-x'))).toBeNull();
    await user.click(screen.getByTestId(institutePeople.accessRestoreBtn('link-x')));
    const dialog = await screen.findByTestId(institutePeople.accessDialog);

    expect(dialog).toHaveTextContent(fill(copy.restore.consequence));
    await user.click(screen.getByTestId(institutePeople.accessConfirmBtn));

    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith(VARIABLES));
    expect(revokeMock).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(fill(copy.restore.success));
  });

  it.each([
    ['GUARDIAN_LINK_NOT_FOUND', copy.errors.GUARDIAN_LINK_NOT_FOUND],
    ['FORBIDDEN', copy.errors.FORBIDDEN],
    ['INTERNAL_ERROR', copy.errors.unknown],
  ])('should keep the dialog open and show the copy for %s', async (code, message) => {
    revokeMock.mockRejectedValue(codeError(code));
    renderButton(false);
    const user = userEvent.setup();
    await user.click(screen.getByTestId(institutePeople.accessRevokeBtn('link-x')));
    await user.click(await screen.findByTestId(institutePeople.accessConfirmBtn));

    const error = await screen.findByTestId(institutePeople.accessError);
    expect(error).toHaveTextContent(fill(copy.revoke.failed));
    expect(error).toHaveTextContent(fill(message));
    expect(screen.getByTestId(institutePeople.accessDialog)).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
