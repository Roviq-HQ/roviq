import type { FieldPolicy } from '@apollo/client/cache';
import { ApolloClient, InMemoryCache } from '@apollo/client/core';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ApolloLink } from '@apollo/client/link';
import { SetContextLink } from '@apollo/client/link/context';
import { ErrorLink } from '@apollo/client/link/error';
import { HttpLink } from '@apollo/client/link/http';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition, relayStylePagination } from '@apollo/client/utilities';
import { OperationTypeNode } from 'graphql';
import { createClient } from 'graphql-ws';
import { from, Observable, type Subscription, switchMap } from 'rxjs';
import type { LiveConnection } from './live-connection';
import { tagNetworkFailures } from './network-fetch';
import { resolveWsConnectionParams } from './ws-ticket';

export interface ApolloClientConfig {
  httpUrl: string;
  wsUrl: string;
  getAccessToken: () => string | null;
  onAuthError: () => void;
  /** A request failed before a GraphQL response arrived (offline, server down). */
  onNetworkError: () => void;
  /** Called when a GraphQL error with code IMPERSONATION_ENDED is received. */
  onImpersonationEnded?: () => void;
  /** Called when a view-only impersonation session tried to change something. */
  onImpersonationReadOnly?: () => void;
  /** Called when the server refuses a request until the account changes its password. */
  onPasswordChangeRequired?: () => void;
  /** Base API URL for ws-ticket endpoint. If provided, uses ticket-based WS auth. */
  apiUrl?: string;
  /** Called to refresh the access token. If provided, auth errors retry once after refresh. */
  onTokenRefresh?: () => Promise<string | null>;
  /** State of the live-updates socket, shown by the app; also lets it reconnect and resume. */
  live?: LiveConnection;
}

const IMPERSONATION_TOKEN_KEY = 'roviq-impersonation-token';

/** Handle an impersonation-ended GraphQL error: clear session storage and notify. */
function handleImpersonationEnded(config: ApolloClientConfig): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY);
  }
  config.onImpersonationEnded?.();
}

/** Handle an auth error: attempt token refresh + retry, or call onAuthError. */
function handleAuthError(
  config: ApolloClientConfig,
  operation: Parameters<ConstructorParameters<typeof ErrorLink>[0]>[0]['operation'],
  forward: Parameters<ConstructorParameters<typeof ErrorLink>[0]>[0]['forward'],
): Observable<ApolloLink.Result> | undefined {
  if (config.onTokenRefresh) {
    // Convert the refresh promise into an Observable, then switchMap to the
    // retried operation. This ensures forward(operation) is only called after
    // the token has resolved.
    return from(config.onTokenRefresh()).pipe(
      switchMap((newToken) => {
        if (newToken) {
          operation.setContext({
            headers: {
              ...(operation.getContext().headers as Record<string, string>),
              authorization: `Bearer ${newToken}`,
            },
          });
          return forward(operation);
        }
        config.onAuthError();
        return [];
      }),
    );
  }
  config.onAuthError();
  return;
}

/** Process a single GraphQL error from the error link. Returns true if handled (stop iteration). */
function processGraphQLError(
  err: { extensions?: Record<string, unknown>; message: string },
  config: ApolloClientConfig,
  operation: Parameters<ConstructorParameters<typeof ErrorLink>[0]>[0]['operation'],
  forward: Parameters<ConstructorParameters<typeof ErrorLink>[0]>[0]['forward'],
): ReturnType<ConstructorParameters<typeof ErrorLink>[0]> | false {
  if (err.extensions?.code === 'IMPERSONATION_ENDED') {
    handleImpersonationEnded(config);
    return false;
  }
  if (err.extensions?.code === 'IMPERSONATION_READ_ONLY') {
    config.onImpersonationReadOnly?.();
    return false;
  }
  if (err.extensions?.code === 'PASSWORD_CHANGE_REQUIRED') {
    config.onPasswordChangeRequired?.();
    return false;
  }
  // SESSION_EXPIRED: the refresh token sent with a session operation was rejected.
  if (err.extensions?.code === 'UNAUTHENTICATED' || err.extensions?.code === 'SESSION_EXPIRED') {
    return handleAuthError(config, operation, forward);
  }
  return false;
}

interface CursorConnection {
  edges?: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Cursor pagination for connections whose cursor travels in `filter.after`, not a top-level `after`. */
export function filterCursorPagination(): FieldPolicy<CursorConnection> {
  return {
    keyArgs: (args) => {
      const filter = isRecord(args?.filter) ? args.filter : {};
      const { after: _after, first: _first, ...rest } = filter;
      return `filter:${JSON.stringify(rest)}`;
    },
    merge(existing, incoming, { args }) {
      const after = isRecord(args?.filter) ? args.filter.after : undefined;
      if (!existing || !after) return incoming;
      return { ...incoming, edges: [...(existing.edges ?? []), ...(incoming.edges ?? [])] };
    },
  };
}

export function createApolloClient(config: ApolloClientConfig) {
  const httpLink = new HttpLink({
    uri: config.httpUrl,
    // Late-bound like Apollo's own default, so a replaced global fetch is still used.
    fetch: tagNetworkFailures((input, init) => fetch(input, init)),
  });

  const authLink = new SetContextLink((prevContext) => {
    const token = config.getAccessToken();
    return {
      headers: {
        ...prevContext.headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    };
  });

  const errorLink = new ErrorLink(({ error, forward, operation }) => {
    if (CombinedGraphQLErrors.is(error)) {
      for (const err of error.errors) {
        const result = processGraphQLError(err, config, operation, forward);
        if (result !== false) return result;
      }
    } else if (operation.operationType !== OperationTypeNode.MUTATION) {
      // A failed write is reported by the screen that made it; a failed read has no other message.
      config.onNetworkError();
    }
    return undefined;
  });

  const live = config.live;
  // Assigned below; the socket's `connected` event needs it to refetch after a reconnect.
  let apolloClient: ApolloClient | undefined;

  const wsClient = createClient({
    url: config.wsUrl,
    connectionParams: async () => {
      if (!config.apiUrl) return {};
      return resolveWsConnectionParams({
        apiUrl: config.apiUrl,
        getAccessToken: config.getAccessToken,
        isImpersonating: () =>
          typeof window !== 'undefined' && sessionStorage.getItem(IMPERSONATION_TOKEN_KEY) !== null,
        refreshToken: config.onTokenRefresh,
        onSessionEnded: () => {
          live?.onSessionEnded();
          config.onAuthError();
        },
        onImpersonationEnded: () => {
          live?.onSessionEnded();
          handleImpersonationEnded(config);
        },
      });
    },
    shouldRetry: () => true,
    retryAttempts: Infinity,
    retryWait: async (retryCount) => {
      const delay = Math.min(1000 * 2 ** retryCount, 30000);
      if (live) return live.waitBeforeRetry(delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    },
    on: live
      ? {
          connecting: () => live.onConnecting(),
          connected: (_socket, _payload, wasRetry) => {
            const before = live.getSnapshot().status;
            live.onConnected();
            // Events sent while the socket was down are lost; the queries on screen catch up.
            if (wasRetry || before === 'reconnecting' || before === 'offline') {
              void apolloClient?.refetchQueries({ include: 'active' });
            }
          },
          closed: (event) => live.onClosed(closeCode(event)),
        }
      : undefined,
  });

  if (live && typeof window !== 'undefined') {
    window.addEventListener('offline', () => {
      live.setOnline(false);
      // A dead socket can look open for minutes; dropping it starts the retries at once.
      wsClient.terminate();
    });
    window.addEventListener('online', () => live.setOnline(true));
  }

  const wsLink = live
    ? resumeAfterSessionEnd(live).concat(new GraphQLWsLink(wsClient))
    : new GraphQLWsLink(wsClient);

  const httpChain = errorLink.concat(authLink).concat(httpLink);

  const link = ApolloLink.split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
    },
    wsLink,
    httpChain,
  );

  const cache = new InMemoryCache({
    typePolicies: {
      Institute: { keyFields: ['id'] },
      User: { keyFields: ['id'] },
      Student: { keyFields: ['id'] },
      Section: { keyFields: ['id'] },
      Role: { keyFields: ['id'] },
      AuditLog: { keyFields: ['id'] },
      SubscriptionPlanModel: { keyFields: ['id'] },
      SubscriptionModel: { keyFields: ['id'] },
      InvoiceModel: { keyFields: ['id'] },
      // Link rows have no `id`; without a key a refetch replaces them unmerged.
      GuardianLinkedStudentModel: { keyFields: ['linkId'] },
      StudentGuardianModel: { keyFields: ['linkId'] },
      Query: {
        fields: {
          auditLogs: relayStylePagination(['filter']),
          adminAuditLogs: relayStylePagination(['filter']),
          subscriptions: relayStylePagination(['filter']),
          invoices: relayStylePagination(['instituteId', 'filter']),
          notificationDeliveryLog: relayStylePagination(['filter']),
          adminListUsers: filterCursorPagination(),
          adminListResellers: filterCursorPagination(),
          adminListInstitutes: filterCursorPagination(),
          resellerListTeamMembers: filterCursorPagination(),
        },
      },
    },
  });

  apolloClient = new ApolloClient({
    link,
    cache,
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'cache-and-network',
      },
    },
  });
  return apolloClient;
}

function closeCode(event: unknown): number | undefined {
  return typeof event === 'object' &&
    event !== null &&
    'code' in event &&
    typeof event.code === 'number'
    ? event.code
    : undefined;
}

/**
 * A subscription that fails because the session ended is held, not failed: the screen keeps
 * its data, and `live.resume()` after the next sign-in starts it again.
 */
export function resumeAfterSessionEnd(live: LiveConnection): ApolloLink {
  return new ApolloLink(
    (operation, forward) =>
      new Observable<ApolloLink.Result>((observer) => {
        let inner: Subscription | undefined;
        let forget: (() => void) | undefined;
        const start = () => {
          inner = forward(operation).subscribe({
            next: (value) => observer.next(value),
            error: (err: unknown) => {
              if (live.isSessionEnded()) forget = live.holdUntilResume(start);
              else observer.error(err);
            },
            complete: () => observer.complete(),
          });
        };
        start();
        return () => {
          inner?.unsubscribe();
          forget?.();
        };
      }),
  );
}
