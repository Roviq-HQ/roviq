'use client';

import { gql, useMutation, useQuery } from '@roviq/graphql';
import type {
  ResellerEndImpersonationMutation,
  ResellerEndImpersonationMutationVariables,
  ResellerImpersonationSessionsQuery,
  ResellerImpersonationSessionsQueryVariables,
} from './use-reseller-impersonation-sessions.generated';

export type ResellerImpersonationSessionNode =
  ResellerImpersonationSessionsQuery['resellerImpersonationSessions'][number];

const RESELLER_IMPERSONATION_SESSIONS_QUERY = gql`
  query ResellerImpersonationSessions($activeOnly: Boolean, $first: Int) {
    resellerImpersonationSessions(activeOnly: $activeOnly, first: $first) {
      id
      impersonatorName
      impersonatorScope
      targetUserName
      targetTenantId
      targetTenantName
      reason
      ipAddress
      startedAt
      expiresAt
      endedAt
      endedReason
      otpVerified
      status
    }
  }
`;

const RESELLER_END_IMPERSONATION_MUTATION = gql`
  mutation ResellerEndImpersonation($sessionId: String!) {
    resellerEndImpersonation(sessionId: $sessionId)
  }
`;

/** Lists impersonation sessions started by the current reseller's team. */
export function useResellerImpersonationSessions(
  variables: ResellerImpersonationSessionsQueryVariables = {},
) {
  const { data, loading, error, refetch } = useQuery<
    ResellerImpersonationSessionsQuery,
    ResellerImpersonationSessionsQueryVariables
  >(RESELLER_IMPERSONATION_SESSIONS_QUERY, { variables, notifyOnNetworkStatusChange: true });

  return {
    sessions: data?.resellerImpersonationSessions ?? [],
    loading,
    error,
    refetch,
  };
}

/** Terminates an active impersonation session. */
export function useTerminateImpersonationSession() {
  return useMutation<ResellerEndImpersonationMutation, ResellerEndImpersonationMutationVariables>(
    RESELLER_END_IMPERSONATION_MUTATION,
  );
}
