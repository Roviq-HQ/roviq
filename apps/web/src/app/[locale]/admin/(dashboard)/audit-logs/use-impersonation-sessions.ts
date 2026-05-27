'use client';

import { gql, useQuery } from '@roviq/graphql';
import type {
  ImpersonationSessionsQuery,
  ImpersonationSessionsQueryVariables,
} from './use-impersonation-sessions.generated';

export type ImpersonationSessionNode = ImpersonationSessionsQuery['impersonationSessions'][number];

const IMPERSONATION_SESSIONS_QUERY = gql`
  query ImpersonationSessions($activeOnly: Boolean, $sessionId: String, $first: Int) {
    impersonationSessions(activeOnly: $activeOnly, sessionId: $sessionId, first: $first) {
      id
      impersonatorId
      impersonatorScope
      impersonatorName
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
      otpVerified
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
    sessions: data?.impersonationSessions ?? [],
    loading,
    error,
    refetch,
  };
}
