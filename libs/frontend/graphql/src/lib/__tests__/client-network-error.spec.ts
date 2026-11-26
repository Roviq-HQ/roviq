import { gql } from '@apollo/client/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApolloClient } from '../client';

const QUERY = gql`
  query Ping {
    ping
  }
`;

const MUTATION = gql`
  mutation Save {
    save
  }
`;

function makeClient(onNetworkError: () => void) {
  return createApolloClient({
    httpUrl: 'http://api.test/graphql',
    wsUrl: 'ws://api.test/graphql',
    getAccessToken: () => null,
    onAuthError: vi.fn(),
    onNetworkError,
  });
}

function graphQLErrorResponse(): Response {
  return new Response(
    JSON.stringify({ data: null, errors: [{ message: 'No', extensions: { code: 'FORBIDDEN' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('createApolloClient onNetworkError', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should call onNetworkError when a query cannot reach the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const onNetworkError = vi.fn();

    await expect(makeClient(onNetworkError).query({ query: QUERY })).rejects.toThrow(
      'Failed to fetch',
    );

    expect(onNetworkError).toHaveBeenCalledTimes(1);
    expect(onNetworkError).toHaveBeenCalledWith();
  });

  it('should not call onNetworkError when a mutation cannot reach the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const onNetworkError = vi.fn();

    await expect(makeClient(onNetworkError).mutate({ mutation: MUTATION })).rejects.toThrow(
      'Failed to fetch',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNetworkError).not.toHaveBeenCalled();
  });

  it('should not call onNetworkError when a query gets a GraphQL error', async () => {
    fetchMock.mockResolvedValue(graphQLErrorResponse());
    const onNetworkError = vi.fn();

    await expect(makeClient(onNetworkError).query({ query: QUERY })).rejects.toThrow('No');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNetworkError).not.toHaveBeenCalled();
  });

  it('should not call onNetworkError when a mutation gets a GraphQL error', async () => {
    fetchMock.mockResolvedValue(graphQLErrorResponse());
    const onNetworkError = vi.fn();

    await expect(makeClient(onNetworkError).mutate({ mutation: MUTATION })).rejects.toThrow('No');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNetworkError).not.toHaveBeenCalled();
  });
});
