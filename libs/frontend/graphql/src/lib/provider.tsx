'use client';

import { ApolloProvider as BaseApolloProvider } from '@apollo/client/react';
import * as React from 'react';
import { toast } from 'sonner';
import { createApolloClient } from './client';

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

  if (!clientRef.current) {
    clientRef.current = createApolloClient({
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

  return <BaseApolloProvider client={clientRef.current}>{children}</BaseApolloProvider>;
}
