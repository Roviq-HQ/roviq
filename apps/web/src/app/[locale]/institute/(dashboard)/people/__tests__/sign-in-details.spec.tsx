import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import signInDetailsEn from '@web-messages/en/signInDetails.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resendStaffMock, resendGuardianMock, toastSuccess, toastError } = vi.hoisted(() => ({
  resendStaffMock: vi.fn(),
  resendGuardianMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('../staff/use-staff', () => ({
  useResendStaffSignInDetails: () => [resendStaffMock, { loading: false }],
}));
vi.mock('../guardians/use-guardians', () => ({
  useResendGuardianSignInDetails: () => [resendGuardianMock, { loading: false }],
}));

import { ResendSignInDetailsButton, SignInStatusBadge } from '../sign-in-details';

const STAFF_ID = 'staff-1';

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('sign-in-resend-btn'));
  await screen.findByTestId('sign-in-resend-dialog');
  return user;
}

describe('SignInStatusBadge', () => {
  it('should show the date the details were sent', () => {
    renderWithProviders(
      <SignInStatusBadge
        profileId={STAFF_ID}
        status="DETAILS_SENT"
        sentAt="2026-11-20T10:00:00.000Z"
      />,
    );

    expect(screen.getByTestId('sign-in-status-staff-1')).toHaveTextContent(
      'Sign-in details sent on 20/11/2026',
    );
  });

  it.each([
    ['NOT_SENT_NO_CONTACT', 'Not sent: no email or phone'],
    ['SEND_FAILED', 'Sending failed'],
    ['SIGNED_IN', 'Signed in'],
    ['NOT_SENT', 'Not sent yet'],
  ] as const)('should label %s', (status, text) => {
    renderWithProviders(<SignInStatusBadge profileId={STAFF_ID} status={status} sentAt={null} />);

    expect(screen.getByTestId('sign-in-status-staff-1')).toHaveTextContent(text);
  });
});

describe('ResendSignInDetailsButton', () => {
  beforeEach(() => {
    resendStaffMock.mockReset();
    resendStaffMock.mockResolvedValue({ data: { resendStaffSignInDetails: true } });
    resendGuardianMock.mockReset();
    resendGuardianMock.mockResolvedValue({ data: { resendGuardianSignInDetails: true } });
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('should send only after the admin confirms', async () => {
    renderWithProviders(
      <ResendSignInDetailsButton
        kind="staff"
        profileId={STAFF_ID}
        status="NOT_SENT"
        name="Kiran Das"
      />,
    );
    const user = await openDialog();

    expect(resendStaffMock).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('sign-in-resend-confirm-btn'));

    await waitFor(() => {
      expect(resendStaffMock).toHaveBeenCalledWith({ variables: { staffProfileId: STAFF_ID } });
    });
    expect(toastSuccess).toHaveBeenCalledWith('New sign-in details are on their way to Kiran Das');
    expect(resendGuardianMock).not.toHaveBeenCalled();
  });

  it('should send nothing when the admin cancels', async () => {
    renderWithProviders(
      <ResendSignInDetailsButton
        kind="guardian"
        profileId="guardian-1"
        status="SEND_FAILED"
        name="Sunita Rao"
      />,
    );
    const user = await openDialog();

    await user.click(screen.getByTestId('sign-in-resend-cancel-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('sign-in-resend-dialog')).not.toBeInTheDocument();
    });
    expect(resendGuardianMock).not.toHaveBeenCalled();
  });

  it('should send a guardian’s details through the guardian mutation', async () => {
    renderWithProviders(
      <ResendSignInDetailsButton
        kind="guardian"
        profileId="guardian-1"
        status="DETAILS_SENT"
        name="Sunita Rao"
      />,
    );
    const user = await openDialog();

    await user.click(screen.getByTestId('sign-in-resend-confirm-btn'));

    await waitFor(() => {
      expect(resendGuardianMock).toHaveBeenCalledWith({
        variables: { guardianProfileId: 'guardian-1' },
      });
    });
  });

  it('should be hidden once the person has signed in', () => {
    renderWithProviders(
      <ResendSignInDetailsButton
        kind="staff"
        profileId={STAFF_ID}
        status="SIGNED_IN"
        name="Kiran Das"
      />,
    );

    expect(screen.queryByTestId('sign-in-resend-btn')).not.toBeInTheDocument();
  });

  it('should be hidden for a role that cannot update staff', () => {
    renderWithProviders(
      <ResendSignInDetailsButton
        kind="staff"
        profileId={STAFF_ID}
        status="NOT_SENT"
        name="Kiran Das"
      />,
      { abilityRules: [{ action: 'read', subject: 'Staff' }] },
    );

    expect(screen.queryByTestId('sign-in-resend-btn')).not.toBeInTheDocument();
  });

  it.each([
    'SIGN_IN_CONTACT_MISSING',
    'SIGN_IN_ALREADY_COMPLETED',
    'TOO_MANY_REQUESTS',
  ] as const)('should show translated copy for %s and keep the dialog open', async (code) => {
    resendStaffMock.mockRejectedValueOnce(
      new CombinedGraphQLErrors({
        errors: [{ message: 'raw server text', extensions: { code } }],
      }),
    );
    renderWithProviders(
      <ResendSignInDetailsButton
        kind="staff"
        profileId={STAFF_ID}
        status="NOT_SENT"
        name="Kiran Das"
      />,
    );
    const user = await openDialog();

    await user.click(screen.getByTestId('sign-in-resend-confirm-btn'));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Could not send sign-in details to Kiran Das', {
        description: signInDetailsEn.resend.errors[code].replace('{name}', 'Kiran Das'),
        duration: Number.POSITIVE_INFINITY,
      });
    });
    expect(screen.getByTestId('sign-in-resend-dialog')).toBeInTheDocument();
  });
});
