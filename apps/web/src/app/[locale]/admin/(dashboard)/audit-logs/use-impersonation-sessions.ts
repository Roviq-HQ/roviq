'use client';

import { gql, useQuery } from '@roviq/graphql';
import type {
  ImpersonationSessionsQuery,
  ImpersonationSessionsQueryVariables,
} from './use-impersonation-sessions.generated';

export type ImpersonationSessionNode =
  ImpersonationSessionsQuery['adminImpersonationSessions'][number];

const IMPERSONATION_SESSIONS_QUERY = gql`
  query ImpersonationSessions($activeOnly: Boolean, $sessionId: String, $first: Int) {
    adminImpersonationSessions(activeOnly: $activeOnly, sessionId: $sessionId, first: $first) {
      id
      impersonatorId
      impersonatorScope
      impersonatorName
      impersonatorRole
      targetUserId
      targetUserName
      targetTenantId
      targetTenantName
      reason
      ipAddress
      userAgent
      startedAt
      expiresAt
      endedAt
      endedReason
      otpVerifiedAt
      otpVerifiedByName
      status
    }
  }
`;

/** Lists impersonation sessions (platform scope). Pass `sessionId` to fetch a single session. */
export function useImpersonationSessions(variables: ImpersonationSessionsQueryVariables = {}) {
  const { data, loading, error, refetch } = useQuery<
    ImpersonationSessionsQuery,
    ImpersonationSessionsQueryVariables
  >(IMPERSONATION_SESSIONS_QUERY, { variables, notifyOnNetworkStatusChange: true });

  return {
    sessions: data?.adminImpersonationSessions ?? [],
    loading,
    error,
    refetch,
  };
}
