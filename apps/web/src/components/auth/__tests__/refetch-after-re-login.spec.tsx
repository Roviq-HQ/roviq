import '@testing-library/jest-dom/vitest';
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefetchAfterReLogin } from '../refetch-after-re-login';

const auth = vi.hoisted(() => ({ sessionRestores: 0 }));
vi.mock('@roviq/auth', () => ({ useAuth: () => auth }));
const live = vi.hoisted(() => ({ resume: vi.fn(), noteRefetched: vi.fn() }));
vi.mock('@roviq/graphql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/graphql')>()),
  useLiveConnection: () => live,
}));

function renderWith(client: ApolloClient) {
  const view = render(
    <ApolloProvider client={client}>
      <RefetchAfterReLogin />
    </ApolloProvider>,
  );
  return () =>
    view.rerender(
      <ApolloProvider client={client}>
        <RefetchAfterReLogin />
      </ApolloProvider>,
    );
}

describe('RefetchAfterReLogin', () => {
  let client: ApolloClient;

  beforeEach(() => {
    auth.sessionRestores = 0;
    live.resume.mockReset();
    live.noteRefetched.mockReset();
    client = new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() });
  });

  it('should refetch the active queries once per restore', () => {
    const refetch = vi.spyOn(client, 'refetchQueries');
    const rerender = renderWith(client);
    expect(refetch).not.toHaveBeenCalled();

    auth.sessionRestores = 1;
    rerender();
    rerender();

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ include: 'active' });
  });

  it('should restart the live updates that stopped with the session, once per restore', () => {
    const rerender = renderWith(client);
    expect(live.resume).not.toHaveBeenCalled();

    auth.sessionRestores = 1;
    rerender();
    rerender();

    expect(live.resume).toHaveBeenCalledTimes(1);
    expect(live.noteRefetched).toHaveBeenCalledTimes(1);
  });
});
