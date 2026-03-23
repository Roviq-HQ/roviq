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
  /** Base API URL for ws-ticket endpoint. If provided, uses ticket-based WS auth. */
  apiUrl?: string;
  /** Called to refresh the access token on auth error. Returns the new token or null. */
  onTokenRefresh?: () => Promise<string | null>;
  children: React.ReactNode;
}

export function GraphQLProvider({
  httpUrl,
  wsUrl,
  getAccessToken,
  onAuthError,
  onImpersonationEnded,
  onTokenRefresh,
  apiUrl,
  children,
}: GraphQLProviderProps) {
  const clientRef = React.useRef<ReturnType<typeof createApolloClient> | null>(null);

  if (!clientRef.current) {
    clientRef.current = createApolloClient({
      httpUrl,
      wsUrl,
      getAccessToken,
      onAuthError,
      onImpersonationEnded,
      onTokenRefresh,
      apiUrl,
      onNetworkError: (message) => {
        toast.error('Network Error', { description: message });
      },
    });
  }

  return <BaseApolloProvider client={clientRef.current}>{children}</BaseApolloProvider>;
}
