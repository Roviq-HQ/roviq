'use client';

import { gql, useMutation, useQuery, useSubscription } from '@roviq/graphql';
import {
  AdminEndImpersonationDocument,
  AdminImpersonationSessionCreatedDocument,
  AdminImpersonationSessionEndedDocument,
  AdminImpersonationSessionsDocument,
} from './use-admin-impersonation-sessions.generated';

export const ADMIN_IMPERSONATION_SESSIONS = gql`
  query AdminImpersonationSessions($activeOnly: Boolean, $first: Int) {
    adminImpersonationSessions(activeOnly: $activeOnly, first: $first) {
      id
      impersonatorName
      impersonatorScope
      targetUserName
      targetTenantId
      targetTenantName
      reason
      startedAt
      expiresAt
      endedAt
      endedReason
      status
    }
  }
`;

export const ADMIN_END_IMPERSONATION = gql`
  mutation AdminEndImpersonation($sessionId: String!) {
    adminEndImpersonation(sessionId: $sessionId)
  }
`;

export const ADMIN_IMPERSONATION_SESSION_CREATED = gql`
  subscription AdminImpersonationSessionCreated {
    adminImpersonationSessionCreated {
      id
    }
  }
`;

export const ADMIN_IMPERSONATION_SESSION_ENDED = gql`
  subscription AdminImpersonationSessionEnded {
    adminImpersonationSessionEnded {
      id
    }
  }
`;

// An event can be missed (socket not yet connected, a session ended by a database trigger
// or by expiry between sweeps), so the list also re-reads on this interval.
const FALLBACK_POLL_MS = 15_000;

/**
 * Sessions across the platform, newest first. The list re-reads itself whenever any
 * session starts or ends, and on a slow poll as a fallback, so the page stays current
 * without a reload.
 */
export function useAdminImpersonationSessions(activeOnly: boolean, enabled: boolean) {
  const { data, loading, error, refetch } = useQuery(AdminImpersonationSessionsDocument, {
    variables: { activeOnly, first: 100 },
    fetchPolicy: 'cache-and-network',
    skip: !enabled,
    pollInterval: FALLBACK_POLL_MS,
  });
  const onData = () => void refetch();
  useSubscription(AdminImpersonationSessionCreatedDocument, { skip: !enabled, onData });
  useSubscription(AdminImpersonationSessionEndedDocument, { skip: !enabled, onData });

  return { sessions: data?.adminImpersonationSessions ?? [], loading, error, refetch };
}

export function useAdminEndImpersonation() {
  return useMutation(AdminEndImpersonationDocument);
}
