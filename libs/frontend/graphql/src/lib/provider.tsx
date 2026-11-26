'use client';

import { ApolloProvider as BaseApolloProvider } from '@apollo/client/react';
import * as React from 'react';
import { toast } from 'sonner';
import { bindBrowserConnectivity, createApolloClient } from './client';
import {
  createLiveConnection,
  type LiveConnection,
  type LiveConnectionState,
} from './live-connection';

interface GraphQLProviderProps {
  httpUrl: string;
  wsUrl: string;
  getAccessToken: () => string | null;
  onAuthError: () => void;
  /** Called when a GraphQL error with code IMPERSONATION_ENDED is received. */
  onImpersonationEnded?: () => void;
  /** Called when a view-only impersonation session tried to change something. */
  onImpersonationReadOnly?: () => void;
  /** Called when the server refuses a request until the account changes its password. */
  onPasswordChangeRequired?: () => void;
  /** Base API URL for ws-ticket endpoint. If provided, uses ticket-based WS auth. */
  apiUrl?: string;
  /** Called to refresh the access token on auth error. Returns the new token or null. */
  onTokenRefresh?: () => Promise<string | null>;
  /** Translated toast shown when a request cannot reach the server. */
  networkErrorLabels: { title: string; description: string };
  children: React.ReactNode;
}

export function GraphQLProvider({
  httpUrl,
  wsUrl,
  getAccessToken,
  onAuthError,
  onImpersonationEnded,
  onImpersonationReadOnly,
  onPasswordChangeRequired,
  onTokenRefresh,
  apiUrl,
  networkErrorLabels,
  children,
}: GraphQLProviderProps) {
  // The client is created once; a locale switch must still reach the toast.
  const labelsRef = React.useRef(networkErrorLabels);
  labelsRef.current = networkErrorLabels;
  const clientRef = React.useRef<ReturnType<typeof createApolloClient> | null>(null);
  const liveRef = React.useRef<LiveConnection | null>(null);

  if (!clientRef.current) {
    liveRef.current = createLiveConnection(
      typeof navigator === 'undefined' ? true : navigator.onLine,
    );
    clientRef.current = createApolloClient({
      live: liveRef.current,
      httpUrl,
      wsUrl,
      getAccessToken,
      onAuthError,
      onImpersonationEnded,
      onImpersonationReadOnly,
      onPasswordChangeRequired,
      onTokenRefresh,
      apiUrl,
      onNetworkError: () => {
        toast.error(labelsRef.current.title, {
          id: 'network-error',
          description: labelsRef.current.description,
        });
      },
    });
  }

  React.useEffect(() => {
    const live = liveRef.current;
    if (!live) return;
    return bindBrowserConnectivity(window, live);
  }, []);

  return (
    <LiveConnectionContext.Provider value={liveRef.current}>
      <BaseApolloProvider client={clientRef.current}>{children}</BaseApolloProvider>
    </LiveConnectionContext.Provider>
  );
}

export interface LiveConnectionHandle extends LiveConnectionState {
  /** Connects now instead of waiting for the next retry. */
  reconnectNow: () => void;
  /** Restarts live updates that stopped when the session ended. */
  resume: () => void;
  /** Tells the connection the screen was just reloaded, so the next reconnect does not again. */
  noteRefetched: () => void;
}

const IDLE: LiveConnectionState = { status: 'idle', failedAttempts: 0 };
const noop = () => {};

/** State of the live-updates socket. Outside a `GraphQLProvider` it stays idle. */
export function useLiveConnection(): LiveConnectionHandle {
  const live = React.useContext(LiveConnectionContext);
  const state = React.useSyncExternalStore(
    live?.subscribe ?? subscribeNever,
    live?.getSnapshot ?? getIdle,
    getIdle,
  );
  return {
    ...state,
    reconnectNow: live?.reconnectNow ?? noop,
    resume: live?.resume ?? noop,
    noteRefetched: live ? () => void live.claimRefetch() : noop,
  };
}

const LiveConnectionContext = React.createContext<LiveConnection | null>(null);

function subscribeNever() {
  return noop;
}

function getIdle() {
  return IDLE;
}
