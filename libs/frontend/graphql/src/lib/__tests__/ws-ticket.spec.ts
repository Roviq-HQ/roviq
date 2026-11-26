import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSessionEndedError, resolveWsConnectionParams, type WsTicketDeps } from '../ws-ticket';

function ticketResponse(ticket: string): Response {
  return new Response(JSON.stringify({ ticket }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const refused = () => new Response('', { status: 401 });

function makeDeps(overrides: Partial<WsTicketDeps> = {}): WsTicketDeps {
  return {
    apiUrl: 'http://api.test',
    getAccessToken: () => 'old-token',
    isImpersonating: () => false,
    refreshToken: vi.fn().mockResolvedValue('new-token'),
    onSessionEnded: vi.fn(),
    onImpersonationEnded: vi.fn(),
    ...overrides,
  };
}

function authHeaderOf(call: Parameters<typeof fetch>): string | undefined {
  const headers = call[1]?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

describe('resolveWsConnectionParams', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the ticket from /api/auth/ws-ticket', async () => {
    fetchMock.mockResolvedValue(ticketResponse('t-1'));
    const deps = makeDeps();

    await expect(resolveWsConnectionParams(deps)).resolves.toEqual({ ticket: 't-1' });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/auth/ws-ticket', {
      headers: { Authorization: 'Bearer old-token' },
    });
    expect(deps.refreshToken).not.toHaveBeenCalled();
  });

  it('does not double the api prefix when the caller already added it', async () => {
    fetchMock.mockResolvedValue(ticketResponse('t-1'));

    await resolveWsConnectionParams(makeDeps({ apiUrl: 'http://api.test/api' }));

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/api/auth/ws-ticket');
  });

  it('refreshes once on a 401 and asks again with the new token', async () => {
    fetchMock.mockResolvedValueOnce(refused()).mockResolvedValueOnce(ticketResponse('t-2'));
    const deps = makeDeps();

    await expect(resolveWsConnectionParams(deps)).resolves.toEqual({ ticket: 't-2' });
    expect(deps.refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaderOf(fetchMock.mock.calls[1] as Parameters<typeof fetch>)).toBe(
      'Bearer new-token',
    );
    expect(deps.onSessionEnded).not.toHaveBeenCalled();
  });

  it('ends the session and stops when the refresh gives no token', async () => {
    fetchMock.mockResolvedValue(refused());
    const deps = makeDeps({ refreshToken: vi.fn().mockResolvedValue(null) });

    await expect(resolveWsConnectionParams(deps)).rejects.toBeInstanceOf(LiveSessionEndedError);
    expect(deps.onSessionEnded).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying, without ending the session, when the refresh could not be made', async () => {
    fetchMock.mockResolvedValue(refused());
    const deps = makeDeps({
      refreshToken: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });

    await expect(resolveWsConnectionParams(deps)).resolves.toEqual({});
    expect(deps.onSessionEnded).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ends the session when the refreshed token is refused too', async () => {
    fetchMock.mockResolvedValue(refused());
    const deps = makeDeps();

    await expect(resolveWsConnectionParams(deps)).rejects.toBeInstanceOf(LiveSessionEndedError);
    expect(deps.refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deps.onSessionEnded).toHaveBeenCalledTimes(1);
  });

  it('ends the impersonation on a 401 in an impersonation tab, without refreshing', async () => {
    fetchMock.mockResolvedValue(refused());
    const deps = makeDeps({ isImpersonating: () => true });

    await expect(resolveWsConnectionParams(deps)).rejects.toBeInstanceOf(LiveSessionEndedError);
    expect(deps.onImpersonationEnded).toHaveBeenCalledTimes(1);
    expect(deps.refreshToken).not.toHaveBeenCalled();
    expect(deps.onSessionEnded).not.toHaveBeenCalled();
  });

  it('returns no ticket, so graphql-ws retries, when the ticket service fails', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    const deps = makeDeps();

    await expect(resolveWsConnectionParams(deps)).resolves.toEqual({});
    expect(deps.refreshToken).not.toHaveBeenCalled();
    expect(deps.onSessionEnded).not.toHaveBeenCalled();
  });

  it('returns no ticket, so graphql-ws retries, when the network is down', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const deps = makeDeps();

    await expect(resolveWsConnectionParams(deps)).resolves.toEqual({});
    expect(deps.onSessionEnded).not.toHaveBeenCalled();
  });

  it('ends the session without asking for a ticket when there is no access token', async () => {
    const deps = makeDeps({ getAccessToken: () => null });

    await expect(resolveWsConnectionParams(deps)).rejects.toBeInstanceOf(LiveSessionEndedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deps.onSessionEnded).toHaveBeenCalledTimes(1);
  });
});
