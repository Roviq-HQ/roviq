/** Thrown from `connectionParams` so graphql-ws closes with 4005, which it never retries. */
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
  /** Resolves to the new access token, or null when the session cannot be refreshed. */
  refreshToken?: () => Promise<string | null>;
  onSessionEnded: () => void;
  onImpersonationEnded: () => void;
}

/**
 * The `connectionParams` of the WebSocket client. Returns `{ ticket }`, or `{}` when the ticket
 * service could not be reached so graphql-ws retries with backoff. Throws
 * `LiveSessionEndedError` when the session is over, which stops the retries.
 */
export async function resolveWsConnectionParams(deps: WsTicketDeps): Promise<{ ticket?: string }> {
  const token = deps.getAccessToken();
  if (!token) throw new LiveSessionEndedError();

  const first = await requestTicket(deps.apiUrl, token);
  if (first.kind !== 'refused') return first.kind === 'ticket' ? { ticket: first.ticket } : {};

  if (deps.isImpersonating()) {
    deps.onImpersonationEnded();
    throw new LiveSessionEndedError();
  }
  const fresh = deps.refreshToken ? await deps.refreshToken().catch(() => null) : null;
  if (!fresh) {
    deps.onSessionEnded();
    throw new LiveSessionEndedError();
  }
  const second = await requestTicket(deps.apiUrl, fresh);
  if (second.kind === 'refused') {
    deps.onSessionEnded();
    throw new LiveSessionEndedError();
  }
  return second.kind === 'ticket' ? { ticket: second.ticket } : {};
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
