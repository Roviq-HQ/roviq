'use client';

import * as React from 'react';
import { useAuth } from './auth-context';
import type { SessionInfo } from './types';

interface UseSessionsOptions {
  /** Function that fetches sessions from the API */
  fetchSessions: (accessToken: string, currentRefreshToken: string) => Promise<SessionInfo[]>;
  /** Function that revokes a single session */
  revokeSessionMutation: (sessionId: string, accessToken: string) => Promise<boolean>;
  /** Function that revokes all other sessions */
  revokeAllOtherSessionsMutation: (
    accessToken: string,
    currentRefreshToken: string,
  ) => Promise<boolean>;
}

interface UseSessionsReturn {
  sessions: SessionInfo[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  revokeSession: (sessionId: string) => Promise<void>;
  revokeAllOtherSessions: () => Promise<void>;
}

export function useSessions({
  fetchSessions,
  revokeSessionMutation,
  revokeAllOtherSessionsMutation,
}: UseSessionsOptions): UseSessionsReturn {
  const { getAccessToken, getRefreshToken } = useAuth();
  const [sessions, setSessions] = React.useState<SessionInfo[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    const token = getAccessToken();
    const refreshToken = getRefreshToken();
    if (!token || !refreshToken) {
      setSessions([]);
      setError('No active session');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchSessions(token, refreshToken);
      setSessions(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      setIsLoading(false);
    }
  }, [fetchSessions, getAccessToken, getRefreshToken]);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  const revokeSession = React.useCallback(
    async (sessionId: string) => {
      const token = getAccessToken();
      if (!token) throw new Error('No access token');
      await revokeSessionMutation(sessionId, token);
      await refetch();
    },
    [revokeSessionMutation, getAccessToken, refetch],
  );

  const revokeAllOtherSessions = React.useCallback(async () => {
    const token = getAccessToken();
    const refreshToken = getRefreshToken();
    if (!token || !refreshToken) throw new Error('No active session');
    await revokeAllOtherSessionsMutation(token, refreshToken);
    await refetch();
  }, [revokeAllOtherSessionsMutation, getAccessToken, getRefreshToken, refetch]);

  return {
    sessions,
    isLoading,
    error,
    refetch,
    revokeSession,
    revokeAllOtherSessions,
  };
}
