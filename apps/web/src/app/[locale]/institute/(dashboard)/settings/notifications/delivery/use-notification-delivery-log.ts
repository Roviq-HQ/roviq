'use client';

import { gql, useQuery } from '@roviq/graphql';
import type { NotificationDeliveryLogFilterInput } from '@roviq/graphql/generated';
import type {
  NotificationDeliveryLogQuery,
  NotificationDeliveryLogQueryVariables,
} from './use-notification-delivery-log.generated';

export type DeliveryLogEntry =
  NotificationDeliveryLogQuery['notificationDeliveryLog']['edges'][number]['node'];

export const DELIVERY_PAGE_SIZE = 25;

export const NOTIFICATION_DELIVERY_LOG_QUERY = gql`
  query NotificationDeliveryLog(
    $filter: NotificationDeliveryLogFilterInput
    $first: Int
    $after: String
  ) {
    notificationDeliveryLog(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          type
          module
          critical
          at
          studentMembershipId
          studentFirstName
          studentLastName
          recipientUserId
          recipientFirstName
          recipientLastName
          relationship
          channels {
            channel
            state
            reason
            at
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`;

export function useNotificationDeliveryLog(filter: NotificationDeliveryLogFilterInput) {
  const { data, loading, error, fetchMore, refetch } = useQuery<
    NotificationDeliveryLogQuery,
    NotificationDeliveryLogQueryVariables
  >(NOTIFICATION_DELIVERY_LOG_QUERY, {
    variables: { filter, first: DELIVERY_PAGE_SIZE },
    notifyOnNetworkStatusChange: true,
  });

  const connection = data?.notificationDeliveryLog;

  const loadMore = () => {
    const endCursor = connection?.pageInfo.endCursor;
    if (!endCursor) return undefined;
    return fetchMore({ variables: { filter, first: DELIVERY_PAGE_SIZE, after: endCursor } });
  };

  return {
    entries: connection?.edges.map((edge) => edge.node) ?? [],
    totalCount: connection?.totalCount ?? 0,
    hasNextPage: connection?.pageInfo.hasNextPage ?? false,
    loading,
    error,
    loadMore,
    refetch,
  };
}
