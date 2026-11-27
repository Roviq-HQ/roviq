import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { MockedResponse } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en/account.json';
import { EmailVerification } from '../email-verification';
import {
  MyEmailVerificationDocument,
  RequestEmailVerificationDocument,
  VerifyEmailDocument,
} from '../email-verification.generated';

const { accountEmail } = testIds;
const copy = messages.emailVerification;
const authState = vi.hoisted(() => ({ isImpersonated: false }));

vi.mock('@roviq/auth', () => ({ useAuth: () => authState }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const state = (isVerified: boolean): MockedResponse => ({
  request: { query: MyEmailVerificationDocument },
  result: { data: { myEmailVerification: { email: 'asha@institute.test', isVerified } } },
});
const sendOk: MockedResponse = {
  request: { query: RequestEmailVerificationDocument },
  result: { data: { requestEmailVerification: true } },
};
const refusal = (code: string) =>
  new CombinedGraphQLErrors({ errors: [{ message: 'raw server text', extensions: { code } }] });

function renderCard(mocks: MockedResponse[]) {
  render(
    <NextIntlClientProvider locale="en" messages={{ account: messages }}>
      <MockedProvider mocks={mocks}>
        <EmailVerification />
      </MockedProvider>
    </NextIntlClientProvider>,
  );
}

describe('EmailVerification', () => {
  it('shows a verified address with nothing to do', async () => {
    renderCard([state(true)]);

    expect(await screen.findByTestId(accountEmail.verifiedBadge)).toHaveTextContent(
      copy.statusVerified,
    );
    expect(screen.getByTestId(accountEmail.address)).toHaveTextContent('asha@institute.test');
    expect(screen.queryByTestId(accountEmail.sendBtn)).not.toBeInTheDocument();
  });

  it('sends a code, verifies it and then shows the address as verified', async () => {
    renderCard([
      state(false),
      sendOk,
      {
        request: { query: VerifyEmailDocument, variables: { code: '123456' } },
        result: { data: { verifyEmail: true } },
      },
      state(true),
    ]);

    await userEvent.click(await screen.findByTestId(accountEmail.sendBtn));
    const input = await screen.findByTestId(accountEmail.codeInput);
    // Letters are dropped: the code is digits only.
    await userEvent.type(input, '12a34b56');
    expect(input).toHaveValue('123456');
    await userEvent.click(screen.getByTestId(accountEmail.verifyBtn));

    expect(await screen.findByTestId(accountEmail.verifiedBadge)).toBeInTheDocument();
    expect(screen.queryByTestId(accountEmail.codeInput)).not.toBeInTheDocument();
  });

  it('asks for all 6 digits before calling the server', async () => {
    renderCard([state(false), sendOk]);

    await userEvent.click(await screen.findByTestId(accountEmail.sendBtn));
    await userEvent.type(await screen.findByTestId(accountEmail.codeInput), '123');
    await userEvent.click(screen.getByTestId(accountEmail.verifyBtn));

    expect(await screen.findByTestId(accountEmail.codeError)).toHaveTextContent(
      copy.errors.codeShape,
    );
  });

  it('explains a wrong or expired code by its error code, never the server text', async () => {
    renderCard([
      state(false),
      sendOk,
      {
        request: { query: VerifyEmailDocument, variables: { code: '654321' } },
        error: refusal('EMAIL_VERIFICATION_CODE_INVALID'),
      },
    ]);

    await userEvent.click(await screen.findByTestId(accountEmail.sendBtn));
    await userEvent.type(await screen.findByTestId(accountEmail.codeInput), '654321');
    await userEvent.click(screen.getByTestId(accountEmail.verifyBtn));

    const error = await screen.findByTestId(accountEmail.codeError);
    expect(error).toHaveTextContent(copy.errors.codeInvalid);
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
  });

  it('shows the code field when a code was already sent a moment ago', async () => {
    renderCard([
      state(false),
      {
        request: { query: RequestEmailVerificationDocument },
        error: refusal('EMAIL_VERIFICATION_TOO_SOON'),
      },
    ]);

    await userEvent.click(await screen.findByTestId(accountEmail.sendBtn));

    await waitFor(() => expect(screen.getByTestId(accountEmail.codeInput)).toBeInTheDocument());
  });

  it('offers no verification while impersonating', async () => {
    authState.isImpersonated = true;
    renderCard([state(false)]);

    expect(await screen.findByTestId(accountEmail.unverifiedBadge)).toBeInTheDocument();
    expect(screen.queryByTestId(accountEmail.sendBtn)).not.toBeInTheDocument();
    authState.isImpersonated = false;
  });

  it('shows the owner-only notice, not a load error, when the server refuses a support session', async () => {
    renderCard([
      {
        request: { query: MyEmailVerificationDocument },
        error: refusal('IMPERSONATION_OWN_ACCOUNT'),
      },
    ]);

    expect(await screen.findByTestId(testIds.ownAccountNotice.notice)).toHaveTextContent(
      messages.ownAccountNotice.title,
    );
    expect(screen.queryByTestId(accountEmail.retryBtn)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.errors.loadFailed)).not.toBeInTheDocument();
  });

  it('keeps the load error with a retry for any other failure', async () => {
    renderCard([
      { request: { query: MyEmailVerificationDocument }, error: refusal('INTERNAL_ERROR') },
    ]);

    expect(await screen.findByTestId(accountEmail.retryBtn)).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.ownAccountNotice.notice)).not.toBeInTheDocument();
  });
});
