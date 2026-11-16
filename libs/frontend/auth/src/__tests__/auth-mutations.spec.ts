import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthMutations } from '../lib/auth-mutations';

const url = 'http://api.test/api/graphql';

afterEach(() => vi.unstubAllGlobals());

describe('session GraphQL requests', () => {
  it('should send the current refresh token when revoking other sessions', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { revokeAllOtherSessions: true } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createAuthMutations(url).revokeAllOtherSessions('access', 'refresh');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access' },
      body: JSON.stringify({
        query: `mutation RevokeAllOtherSessions($currentRefreshToken: String!) {
          revokeAllOtherSessions(currentRefreshToken: $currentRefreshToken)
        }`,
        variables: { currentRefreshToken: 'refresh' },
      }),
    });
  });

  it('should authenticate logout so the server can revoke sessions', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { logout: true } }));
    vi.stubGlobal('fetch', fetchMock);

    await createAuthMutations(url).logout('access');

    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access' },
      body: JSON.stringify({ query: 'mutation Logout { logout }' }),
    });
  });

  it('should identify the current session without requesting token hashes', async () => {
    const sessions = [{ id: 'current', isCurrent: true, createdAt: '2026-11-16T00:00:00.000Z' }];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { mySessions: sessions } }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await createAuthMutations(url).mySessions('access', 'refresh')).toEqual(sessions);
    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access' },
      body: JSON.stringify({
        query: `query MySessions($currentRefreshToken: String!) {
          mySessions(currentRefreshToken: $currentRefreshToken) {
            id
            ipAddress
            userAgent
            deviceInfo
            lastUsedAt
            createdAt
            isCurrent
          }
        }`,
        variables: { currentRefreshToken: 'refresh' },
      }),
    });
  });
});

describe('account language GraphQL requests', () => {
  it('should fetch the saved language using the current access token', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { myPreferredLocale: 'hi' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await createAuthMutations(url).getPreferredLocale('access')).toBe('hi');
    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access' },
      body: JSON.stringify({ query: 'query MyPreferredLocale { myPreferredLocale }' }),
    });
  });

  it.each(['en', 'hi', null])('should save %s without accepting a user id', async (locale) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { updateMyPreferredLocale: locale } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await createAuthMutations(url).savePreferredLocale(locale, 'access')).toBe(locale);
    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access' },
      body: JSON.stringify({
        query:
          'mutation UpdateMyPreferredLocale($input: UpdateLocaleInput!) { updateMyPreferredLocale(input: $input) }',
        variables: { input: { locale } },
      }),
    });
  });
});
