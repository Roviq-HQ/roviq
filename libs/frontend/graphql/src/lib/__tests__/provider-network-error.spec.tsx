import { gql } from '@apollo/client/core';
import { useApolloClient } from '@apollo/client/react';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphQLProvider } from '../provider';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const QUERY = gql`
  query Ping($n: Int) {
    ping(n: $n)
  }
`;

const COPY = { title: 'Could not reach the server', description: 'Check your connection.' };

function FailTwice({ onDone }: { onDone: () => void }) {
  const client = useApolloClient();
  React.useEffect(() => {
    // Different variables, so Apollo does not merge the two requests into one.
    const run = (n: number) =>
      client.query({ query: QUERY, variables: { n }, fetchPolicy: 'network-only' }).catch(() => {});
    void Promise.all([run(1), run(2)]).then(onDone);
  }, [client, onDone]);
  return null;
}

describe('GraphQLProvider network error toast', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should show the given copy under one fixed id, without the raw message', async () => {
    const onDone = vi.fn();
    render(
      <GraphQLProvider
        httpUrl="http://api.test/graphql"
        wsUrl="ws://api.test/graphql"
        getAccessToken={() => null}
        onAuthError={vi.fn()}
        networkErrorLabels={COPY}
      >
        <FailTwice onDone={onDone} />
      </GraphQLProvider>,
    );

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(toast.error).mock.calls) {
      expect(call).toEqual([COPY.title, { description: COPY.description, id: 'network-error' }]);
    }
  });
});
