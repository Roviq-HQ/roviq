import type { MockedResponse } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en/certificates.json';
import VerifyTcPage from '../page';
import { VerifyTcDocument } from '../page.generated';

const { tcVerify } = testIds;
const TOKEN = 'a'.repeat(32);

vi.mock('next/navigation', () => ({ useParams: () => ({ token: TOKEN }) }));

function renderPage(mock: MockedResponse) {
  render(
    <NextIntlClientProvider locale="en" messages={{ certificates: messages }}>
      <MockedProvider mocks={[mock]}>
        <VerifyTcPage />
      </MockedProvider>
    </NextIntlClientProvider>,
  );
}

const request = { query: VerifyTcDocument, variables: { token: TOKEN } };
const tc = {
  serialNumber: 'TC/2026-27/0001',
  isValid: true,
  studentName: 'Asha Verma',
  instituteName: { en: 'Saraswati Vidya Mandir' },
  issuedOn: '2026-11-21',
  isDuplicate: false,
};

describe('VerifyTcPage', () => {
  it('shows a genuine certificate with its number, pupil, institute and issue date', async () => {
    renderPage({ request, result: { data: { verifyTC: tc } } });

    expect(await screen.findByTestId(tcVerify.valid)).toHaveTextContent(
      'This certificate is genuine',
    );
    expect(screen.getByTestId(tcVerify.serial)).toHaveTextContent('TC/2026-27/0001');
    expect(screen.getByText('Asha Verma')).toBeInTheDocument();
    expect(screen.getByText('Saraswati Vidya Mandir')).toBeInTheDocument();
    expect(screen.getByText('21/11/2026')).toBeInTheDocument();
  });

  it('says a cancelled certificate is not valid and marks a duplicate', async () => {
    renderPage({
      request,
      result: { data: { verifyTC: { ...tc, isValid: false, isDuplicate: true } } },
    });

    expect(await screen.findByTestId(tcVerify.invalid)).toHaveTextContent(
      'This certificate is not valid',
    );
    expect(screen.getByTestId(tcVerify.serial)).toHaveTextContent('Duplicate copy');
    expect(screen.queryByTestId(tcVerify.valid)).not.toBeInTheDocument();
  });

  it('says no certificate was found for an unknown token', async () => {
    renderPage({ request, result: { data: { verifyTC: null } } });

    expect(await screen.findByTestId(tcVerify.notFound)).toHaveTextContent('No certificate found');
    expect(screen.queryByTestId(tcVerify.serial)).not.toBeInTheDocument();
  });

  it('offers a retry when the check fails', async () => {
    renderPage({ request, error: new Error('network') });

    expect(await screen.findByTestId(tcVerify.error)).toBeInTheDocument();
    expect(screen.getByTestId(tcVerify.retryBtn)).toBeInTheDocument();
  });
});
