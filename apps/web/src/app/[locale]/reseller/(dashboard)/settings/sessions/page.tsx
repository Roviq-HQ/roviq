'use client';

import { createAuthMutations, useSessions } from '@roviq/auth';
import type { SessionData } from '@roviq/ui';
import { SessionsPage } from '@roviq/ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const GRAPHQL_HTTP = `${API_URL}/api/graphql`;

const authMutations = createAuthMutations(GRAPHQL_HTTP);

export default function ResellerSessionsPage() {
  const { sessions, isLoading, revokeSession, revokeAllOtherSessions } = useSessions({
    fetchSessions: authMutations.mySessions,
    revokeSessionMutation: authMutations.revokeSession,
    revokeAllOtherSessionsMutation: authMutations.revokeAllOtherSessions,
  });

  const mapped: SessionData[] = sessions.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    lastUsedAt: s.lastActiveAt,
    createdAt: s.createdAt,
    isCurrent: s.isCurrent,
  }));

  return (
    <SessionsPage
      sessions={mapped}
      loading={isLoading}
      onRevoke={revokeSession}
      onRevokeAllOther={revokeAllOtherSessions}
    />
  );
}
