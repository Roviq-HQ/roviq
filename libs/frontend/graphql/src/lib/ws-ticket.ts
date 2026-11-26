/** Thrown from `connectionParams` when the session is over; the client's `shouldRetry` refuses it. */
export class LiveSessionEndedError extends Error {
  constructor() {
    super('Live updates stopped: the session ended');
    this.name = 'LiveSessionEndedError';
  }
}

export interface WsTicketDeps {
  apiUrl: string;
  getAccessToken: () => string | null;
  isImpersonating: () => boolean;
  /**
   * Resolves to the new access token, or null when the server refused the refresh (the
   * session is over). Rejects when the refresh could not be made (network, server error).
   */
  refreshToken?: () => Promise<string | null>;
  onSessionEnded: () => void;
  onImpersonationEnded: () => void;
}

/**
 * The `connectionParams` of the WebSocket client. Returns `{ ticket }`, or `{}` when the ticket
 * could not be had this time so graphql-ws retries with backoff. Throws
 * `LiveSessionEndedError` when the session is over.
 */
export async function resolveWsConnectionParams(deps: WsTicketDeps): Promise<{ ticket?: string }> {
  const token = deps.getAccessToken();
  if (!token) return endSession(deps);

  const first = await requestTicket(deps.apiUrl, token);
  if (first.kind !== 'refused') return first.kind === 'ticket' ? { ticket: first.ticket } : {};

  if (deps.isImpersonating()) {
    deps.onImpersonationEnded();
    throw new LiveSessionEndedError();
  }
  if (!deps.refreshToken) return endSession(deps);
  let fresh: string | null;
  try {
    fresh = await deps.refreshToken();
  } catch {
    // The refresh did not reach a verdict; the session may well be fine.
    return {};
  }
  if (!fresh) return endSession(deps);
  const second = await requestTicket(deps.apiUrl, fresh);
  if (second.kind === 'refused') return endSession(deps);
  return second.kind === 'ticket' ? { ticket: second.ticket } : {};
}

function endSession(deps: WsTicketDeps): never {
  deps.onSessionEnded();
  throw new LiveSessionEndedError();
}

type TicketResult =
  | { kind: 'ticket'; ticket: string }
  | { kind: 'refused' }
  | { kind: 'unavailable' };

async function requestTicket(apiUrl: string, accessToken: string): Promise<TicketResult> {
  // The gateway's global prefix is `api`; callers pass the bare origin, sometimes with it.
  const apiBase = apiUrl.replace(/\/api$/, '');
  try {
    const response = await fetch(`${apiBase}/api/auth/ws-ticket`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 401) return { kind: 'refused' };
    if (!response.ok) return { kind: 'unavailable' };
    const body: unknown = await response.json();
    const ticket =
      typeof body === 'object' && body !== null && 'ticket' in body ? body.ticket : undefined;
    return typeof ticket === 'string' ? { kind: 'ticket', ticket } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
