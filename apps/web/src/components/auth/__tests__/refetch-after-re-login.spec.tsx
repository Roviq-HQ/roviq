import '@testing-library/jest-dom/vitest';
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefetchAfterReLogin } from '../refetch-after-re-login';

const auth = vi.hoisted(() => ({ sessionRestores: 0 }));
vi.mock('@roviq/auth', () => ({ useAuth: () => auth }));

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
});
