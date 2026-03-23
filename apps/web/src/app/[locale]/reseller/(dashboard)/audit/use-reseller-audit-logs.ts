'use client';

import { gql, useQuery } from '@roviq/graphql';

export interface ResellerAuditLogNode {
  id: string;
  tenantId: string | null;
  userId: string;
  actorId: string;
  impersonatorId: string | null;
  action: string;
  actionType: string;
  entityType: string;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  source: string;
  createdAt: string;
  actorName: string | null;
  userName: string | null;
  tenantName: Record<string, string> | null;
}

interface ResellerAuditLogsQueryResult {
  resellerAuditLogs: {
    edges: { cursor: string; node: ResellerAuditLogNode }[];
    totalCount: number;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

interface ResellerAuditLogFilterInput {
  entityType?: string;
  actionTypes?: string[];
  userId?: string;
  tenantId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface UseResellerAuditLogsVariables {
  filter?: ResellerAuditLogFilterInput;
  first?: number;
  after?: string;
}

const RESELLER_AUDIT_LOGS_QUERY = gql`
  query ResellerAuditLogs($filter: AuditLogFilterInput, $first: Int, $after: String) {
    resellerAuditLogs(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          tenantId
          userId
          actorId
          impersonatorId
          action
          actionType
          entityType
          entityId
          changes
          metadata
          correlationId
          ipAddress
          userAgent
          source
          createdAt
          actorName
          userName
          tenantName
        }
      }
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export function useResellerAuditLogs(variables: UseResellerAuditLogsVariables) {
  const { data, loading, error, fetchMore } = useQuery<
    ResellerAuditLogsQueryResult,
    UseResellerAuditLogsVariables
  >(RESELLER_AUDIT_LOGS_QUERY, {
    variables,
    notifyOnNetworkStatusChange: true,
  });

  const loadMore = () => {
    const endCursor = data?.resellerAuditLogs.pageInfo.endCursor;
    if (!endCursor) return;
    return fetchMore({ variables: { ...variables, after: endCursor } });
  };

  return {
    logs: data?.resellerAuditLogs.edges.map((edge) => edge.node) ?? [],
    totalCount: data?.resellerAuditLogs.totalCount ?? 0,
    hasNextPage: data?.resellerAuditLogs.pageInfo.hasNextPage ?? false,
    loading,
    error,
    loadMore,
  };
}
