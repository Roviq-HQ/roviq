import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it } from 'vitest';
import enAcademicYears from '../../../messages/en/academicYears.json';
import enError from '../../../messages/en/error.json';
import hiError from '../../../messages/hi/error.json';
import { useErrorCopy } from '../use-error-copy';

function graphQLError(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: 'raw server text', extensions: { code } }],
  });
}

function Copy({
  err,
  fallback,
  namespace,
}: {
  err: unknown;
  fallback?: string;
  namespace?: string;
}) {
  const errorCopy = useErrorCopy(namespace);
  return <p>{errorCopy(err, fallback)}</p>;
}

describe('useErrorCopy', () => {
  it('shows the page namespace copy for a code it knows', () => {
    renderWithProviders(
      <Copy err={graphQLError('ACADEMIC_YEAR_OVERLAP')} namespace="academicYears.errors" />,
    );
    expect(screen.getByText(enAcademicYears.errors.ACADEMIC_YEAR_OVERLAP)).toBeInTheDocument();
  });

  it('falls back to the shared error copy for a code the page does not know', () => {
    renderWithProviders(<Copy err={graphQLError('FORBIDDEN')} namespace="academicYears.errors" />);
    expect(screen.getByText(enError.FORBIDDEN)).toBeInTheDocument();
  });

  it('shows the given fallback, never the server text, for an unknown code', () => {
    renderWithProviders(<Copy err={graphQLError('SOMETHING_NEW')} fallback="Could not save" />);
    expect(screen.getByText('Could not save')).toBeInTheDocument();
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
  });

  it('shows the network message when the request never reached the server', () => {
    renderWithProviders(<Copy err={new TypeError('Failed to fetch')} fallback="Could not save" />);
    expect(screen.getByText(enError.network)).toBeInTheDocument();
  });

  it('treats a server error response as a network failure', () => {
    const err = new ServerError('Bad gateway', {
      response: new Response(null, { status: 502 }),
      bodyText: '',
    });
    renderWithProviders(<Copy err={err} />);
    expect(screen.getByText(enError.network)).toBeInTheDocument();
  });

  it('shows the shared generic copy with no fallback', () => {
    renderWithProviders(<Copy err={new Error('boom')} />);
    expect(screen.getByText(enError.errorDescription)).toBeInTheDocument();
  });

  it('answers in Hindi', () => {
    renderWithProviders(<Copy err={new TypeError('Failed to fetch')} />, { locale: 'hi' });
    expect(screen.getByText(hiError.network)).toBeInTheDocument();
  });
});
