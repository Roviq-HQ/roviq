'use client';

import { gql, useQuery } from '@roviq/graphql';
import { useFormatDate } from '@roviq/i18n';
import type { EntityTimelineData } from '@roviq/ui';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EntityTimelineBase,
  toTimelineChanges,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { AdminUserAuditLogsDocument } from './audit-tab.generated';

export const ADMIN_USER_AUDIT_LOGS = gql`
  query AdminUserAuditLogs($userId: String!, $first: Int, $after: String) {
    adminAuditLogs(filter: { userId: $userId }, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          action
          actionType
          entityType
          entityId
          createdAt
          actorName
          changes
          metadata
        }
      }
    }
  }
`;

/** Actions this user performed, across every institute. */
export function UserAuditTab({ userId }: { userId: string }) {
  const t = useTranslations('auditLogs');
  const tTab = useTranslations('adminUsers.audit');
  const { format } = useFormatDate();
  const { data, loading, fetchMore } = useQuery(AdminUserAuditLogsDocument, {
    variables: { userId, first: 20 },
    fetchPolicy: 'cache-and-network',
  });

  const timelineData: EntityTimelineData | undefined = data
    ? {
        totalCount: data.adminAuditLogs.totalCount,
        events: data.adminAuditLogs.edges.map(({ node }) => ({
          ...node,
          changes: toTimelineChanges(node.changes),
        })),
      }
    : undefined;

  const handleLoadMore = async () => {
    const after = data?.adminAuditLogs.pageInfo.endCursor;
    if (!after) return;
    await fetchMore({ variables: { userId, first: 20, after } });
  };

  return (
    <Card data-testid={testIds.adminUserDetail.auditTab}>
      <CardHeader>
        <CardTitle>{tTab('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <EntityTimelineBase
          entityType="User"
          entityId={userId}
          t={t}
          formatDate={(d, f) => format(d, f)}
          data={timelineData}
          loading={loading}
          hasNextPage={data?.adminAuditLogs.pageInfo.hasNextPage ?? false}
          onLoadMore={handleLoadMore}
          canRead
          emptyStateTestId="user-audit-empty"
        />
      </CardContent>
    </Card>
  );
}
