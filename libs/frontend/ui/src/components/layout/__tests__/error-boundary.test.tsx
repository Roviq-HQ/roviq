import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageErrorBoundary } from '../error-boundary';

afterEach(cleanup);

// Suppress React error boundary console.error noise
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalError;
});

function ThrowingChild({ message }: { message: string }): React.ReactNode {
  throw new Error(message);
}

describe('PageErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <PageErrorBoundary>
        <p>All good</p>
      </PageErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeDefined();
  });

  it('renders fallback with error message when child throws', () => {
    render(
      <PageErrorBoundary>
        <ThrowingChild message="Boom" />
      </PageErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Boom')).toBeDefined();
  });

  it('renders custom labels', () => {
    render(
      <PageErrorBoundary
        labels={{ title: 'Oops', fallbackMessage: 'Bad stuff', tryAgain: 'Retry' }}
      >
        <ThrowingChild message="Boom" />
      </PageErrorBoundary>,
    );
    expect(screen.getByText('Oops')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });

  it('uses fallbackMessage when error is not an Error instance', () => {
    function ThrowNonError(): React.ReactNode {
      throw 'string error'; // eslint-disable-line no-throw-literal
    }

    render(
      <PageErrorBoundary labels={{ fallbackMessage: 'Unknown failure' }}>
        <ThrowNonError />
      </PageErrorBoundary>,
    );
    expect(screen.getByText('Unknown failure')).toBeDefined();
  });

  it('resets error boundary when try again is clicked', () => {
    let shouldThrow = true;

    function MaybeThrow(): React.ReactNode {
      if (shouldThrow) throw new Error('Fail');
      return <p>Recovered</p>;
    }

    render(
      <PageErrorBoundary>
        <MaybeThrow />
      </PageErrorBoundary>,
    );

    expect(screen.getByText('Fail')).toBeDefined();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Recovered')).toBeDefined();
  });
});
