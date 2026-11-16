'use client';

import { createAuthMutations, useSessions } from '@roviq/auth';
import { useFormatDate } from '@roviq/i18n';
import type { SessionData, SessionsPageLabels } from '@roviq/ui';
import { SessionsPage } from '@roviq/ui';
import { parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import * as React from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005';
const GRAPHQL_HTTP = `${API_URL}/api/graphql`;

const authMutations = createAuthMutations(GRAPHQL_HTTP);

export default function AdminSessionsPage() {
  const t = useTranslations('sessions');
  const { format } = useFormatDate();
  const formatDate = React.useCallback((d: string) => format(parseISO(d), 'Pp'), [format]);

  const labels = React.useMemo<SessionsPageLabels>(
    () => ({
      title: t('title'),
      description: t('description'),
      revokeAll: t('revokeAll'),
      revoking: t('revoking'),
      revoke: t('revoke'),
      loading: t('loading'),
      noSessions: t('noSessions'),
      unknownDevice: t('unknownDevice'),
      unknownIp: t('unknownIp'),
      current: t('current'),
      created: t('created'),
      device: t('device'),
      ip: t('ip'),
      lastUsed: t('lastUsed'),
      unknownLastUsed: t('unknownLastUsed'),
      loadError: t('loadError'),
      revokeError: t('revokeError'),
      revoked: t('revoked'),
      revokedOthers: t('revokedOthers'),
      retry: t('retry'),
    }),
    [t],
  );

  const { sessions, isLoading, error, refetch, revokeSession, revokeAllOtherSessions } =
    useSessions({
      fetchSessions: authMutations.mySessions,
      revokeSessionMutation: authMutations.revokeSession,
      revokeAllOtherSessionsMutation: authMutations.revokeAllOtherSessions,
    });

  const mapped: SessionData[] = sessions.map((s) => ({
    id: s.id,
    deviceInfo: s.deviceInfo,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    lastUsedAt: s.lastUsedAt,
    createdAt: s.createdAt,
    isCurrent: s.isCurrent,
  }));

  return (
    <SessionsPage
      sessions={mapped}
      loading={isLoading}
      error={error !== null}
      onRetry={refetch}
      labels={labels}
      formatDate={formatDate}
      onRevoke={revokeSession}
      onRevokeAllOther={revokeAllOtherSessions}
    />
  );
}
