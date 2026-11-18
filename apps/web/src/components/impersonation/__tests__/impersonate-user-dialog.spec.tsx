import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImpersonateUserDialog, type ImpersonationStep } from '../impersonate-user-dialog';

const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const REASON = 'Checking the attendance report for this teacher';

interface FakeTab {
  opener: unknown;
  location: { replace: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
}

let tab: FakeTab;
let openSpy: ReturnType<typeof vi.fn>;

function graphQLError(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: 'raw server text', extensions: { code } }],
  });
}

function renderDialog(props: {
  start: (reason: string) => Promise<ImpersonationStep>;
  verifyOtp?: (requestId: string, otp: string) => Promise<ImpersonationStep>;
  onOpenChange?: (open: boolean) => void;
}) {
  return renderWithProviders(
    <ImpersonateUserDialog
      open
      onOpenChange={props.onOpenChange ?? vi.fn()}
      targetName="Rajesh Sharma"
      instituteName="Saraswati Vidya Mandir"
      start={props.start}
      verifyOtp={props.verifyOtp}
    />,
  );
}

beforeEach(() => {
  tab = { opener: 'parent', location: { replace: vi.fn() }, close: vi.fn() };
  openSpy = vi.fn(() => tab);
  vi.stubGlobal('open', openSpy);
  toast.success.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImpersonateUserDialog', () => {
  it('refuses a reason shorter than 10 characters without calling the server', async () => {
    const start = vi.fn();
    renderDialog({ start });

    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), 'too short');
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(screen.getByText('Write a reason of at least 10 characters.')).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens the institute portal on the exchange page when a code comes back', async () => {
    const start = vi.fn().mockResolvedValue({ code: 'one-time-code' });
    const onOpenChange = vi.fn();
    renderDialog({ start, onOpenChange });

    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), REASON);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(start).toHaveBeenCalledWith(REASON);
    // Opened before the request, so popup blockers count it as part of the click.
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    expect(tab.location.replace).toHaveBeenCalledWith(
      'http://localhost:3000/en/auth/impersonate?code=one-time-code',
    );
    expect(toast.success).toHaveBeenCalledWith('Opened a new tab as Rajesh Sharma.');
  });

  it('asks for the approval code when the server needs one, then opens the tab', async () => {
    const start = vi.fn().mockResolvedValue({ requiresOtp: true, sessionId: 'request-1' });
    const verifyOtp = vi.fn().mockResolvedValue({ code: 'after-otp' });
    renderDialog({ start, verifyOtp });

    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), REASON);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    const otp = await screen.findByRole('textbox', { name: 'Approval code' });
    // The blank tab opened for the first step is closed: no code yet.
    expect(tab.close).toHaveBeenCalledTimes(1);
    // Nothing typed yet, so no validation error on arrival.
    expect(screen.queryByText('Enter the 6-digit code.')).not.toBeInTheDocument();

    await userEvent.type(otp, '12a3456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and open' }));

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('request-1', '123456'));
    expect(tab.location.replace).toHaveBeenCalledWith(
      'http://localhost:3000/en/auth/impersonate?code=after-otp',
    );
  });

  describe('asking for a new code', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function reachOtpStep(start: ReturnType<typeof vi.fn>) {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderDialog({ start, verifyOtp: vi.fn() });
      await user.type(screen.getByRole('textbox', { name: 'Reason' }), REASON);
      await user.click(screen.getByRole('button', { name: 'Start' }));
      await screen.findByRole('textbox', { name: 'Approval code' });
      return user;
    }

    it('waits 30 seconds, then sends a fresh request under the same reason without opening a tab', async () => {
      const start = vi
        .fn()
        .mockResolvedValueOnce({ requiresOtp: true, sessionId: 'request-1' })
        .mockResolvedValueOnce({ requiresOtp: true, sessionId: 'request-2' });
      const verifyOtp = vi.fn().mockResolvedValue({ code: 'after-otp' });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderDialog({ start, verifyOtp });
      await user.type(screen.getByRole('textbox', { name: 'Reason' }), REASON);
      await user.click(screen.getByRole('button', { name: 'Start' }));
      const otp = await screen.findByRole('textbox', { name: 'Approval code' });

      const resend = screen.getByRole('button', { name: 'Send a new code' });
      expect(resend).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(resend).toBeEnabled();

      await user.type(otp, '111');
      openSpy.mockClear();
      await user.click(resend);

      expect(await screen.findByText('A new code was sent.')).toBeInTheDocument();
      expect(start).toHaveBeenLastCalledWith(REASON);
      expect(openSpy).not.toHaveBeenCalled();
      // The half-typed old code is cleared and the wait starts again.
      expect(otp).toHaveValue('');
      expect(resend).toBeDisabled();

      await user.type(otp, '654321');
      await user.click(screen.getByRole('button', { name: 'Verify and open' }));
      await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('request-2', '654321'));
    });

    it('shows why a new code could not be sent and keeps the current request', async () => {
      const start = vi
        .fn()
        .mockResolvedValueOnce({ requiresOtp: true, sessionId: 'request-1' })
        .mockRejectedValueOnce(graphQLError('IMPERSONATION_CONSENT_UNAVAILABLE'));
      const user = await reachOtpStep(start);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await user.click(screen.getByRole('button', { name: 'Send a new code' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'No institute admin can approve this request right now.',
      );
      expect(screen.queryByText('A new code was sent.')).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Approval code' })).toBeInTheDocument();
    });
  });

  it('shows the translated error for the server code, never the raw message', async () => {
    const start = vi.fn().mockRejectedValue(graphQLError('IMPERSONATION_TARGET_INVALID'));
    renderDialog({ start });

    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), REASON);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This user cannot be viewed as: the account is inactive',
    );
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
    expect(tab.close).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic message for an unknown error code', async () => {
    const start = vi.fn().mockRejectedValue(graphQLError('SOMETHING_NEW'));
    renderDialog({ start });

    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), REASON);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not start the session. Try again.',
    );
  });
});
