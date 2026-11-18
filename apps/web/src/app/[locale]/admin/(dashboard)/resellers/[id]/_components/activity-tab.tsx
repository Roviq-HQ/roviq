'use client';

import { gql, useQuery } from '@roviq/graphql';
import { useFormatDate } from '@roviq/i18n';
import type { EntityTimelineData } from '@roviq/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EntityTimelineBase,
  toTimelineChanges,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { AdminResellerAuditLogsDocument } from './activity-tab.generated';

const { adminResellerDetail } = testIds;

export const ADMIN_RESELLER_AUDIT_LOGS = gql`
  query AdminResellerAuditLogs($resellerId: ID!, $first: Int, $after: String) {
    adminAuditLogs(filter: { resellerId: $resellerId }, first: $first, after: $after) {
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

/** The reseller's own staff actions, actions inside its institutes, and platform actions on it. */
export function ResellerActivityTab({ resellerId }: { resellerId: string }) {
  const t = useTranslations('auditLogs');
  const tTab = useTranslations('adminResellers.activity');
  const { format } = useFormatDate();
  const { data, loading, fetchMore } = useQuery(AdminResellerAuditLogsDocument, {
    variables: { resellerId, first: 20 },
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
    await fetchMore({ variables: { resellerId, first: 20, after } });
  };

  return (
    <Card data-testid={adminResellerDetail.activityTab}>
      <CardHeader>
        <CardTitle>{tTab('title')}</CardTitle>
        <CardDescription>{tTab('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <EntityTimelineBase
          entityType="Reseller"
          entityId={resellerId}
          t={t}
          formatDate={(d, f) => format(d, f)}
          data={timelineData}
          loading={loading}
          hasNextPage={data?.adminAuditLogs.pageInfo.hasNextPage ?? false}
          onLoadMore={handleLoadMore}
          canRead
          emptyStateTestId={adminResellerDetail.activityEmpty}
        />
      </CardContent>
    </Card>
  );
}
