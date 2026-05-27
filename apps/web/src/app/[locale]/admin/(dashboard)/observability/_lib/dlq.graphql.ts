'use client';

import { gql, useMutation, useQuery } from '@roviq/graphql';
import type {
  AdminListDlqMessagesQuery,
  AdminListDlqMessagesQueryVariables,
  DiscardDlqMessageMutation,
  DiscardDlqMessageMutationVariables,
  ReplayDlqMessageMutation,
  ReplayDlqMessageMutationVariables,
} from './dlq.graphql.generated';

export type DlqMessageNode =
  AdminListDlqMessagesQuery['adminListDlqMessages']['edges'][number]['node'];

const DLQ_MESSAGE_FIELDS = gql`
  fragment DlqMessageFields on DlqMessageModel {
    id
    originalSubject
    originStream
    payload
    error
    retryCount
    correlationId
    tenantId
    failedAt
    status
    replayedAt
    replayCount
  }
`;

const ADMIN_LIST_DLQ_MESSAGES = gql`
  query AdminListDlqMessages($filter: DlqMessageFilterInput) {
    adminListDlqMessages(filter: $filter) {
      edges {
        cursor
        node {
          ...DlqMessageFields
        }
      }
      totalCount
      pageInfo {
        hasNextPage
        hasPreviousPage
        endCursor
        startCursor
      }
    }
  }
  ${DLQ_MESSAGE_FIELDS}
`;

const REPLAY_DLQ_MESSAGE = gql`
  mutation ReplayDlqMessage($id: ID!) {
    replayDlqMessage(id: $id) {
      ...DlqMessageFields
    }
  }
  ${DLQ_MESSAGE_FIELDS}
`;

const DISCARD_DLQ_MESSAGE = gql`
  mutation DiscardDlqMessage($id: ID!) {
    discardDlqMessage(id: $id) {
      ...DlqMessageFields
    }
  }
  ${DLQ_MESSAGE_FIELDS}
`;

export function useDlqMessages(variables: AdminListDlqMessagesQueryVariables) {
  const { data, loading, error, fetchMore, refetch } = useQuery<
    AdminListDlqMessagesQuery,
    AdminListDlqMessagesQueryVariables
  >(ADMIN_LIST_DLQ_MESSAGES, {
    variables,
    notifyOnNetworkStatusChange: true,
  });

  const loadMore = () => {
    const endCursor = data?.adminListDlqMessages.pageInfo.endCursor;
    if (!endCursor) return;
    return fetchMore({
      variables: { filter: { ...variables.filter, after: endCursor } },
    });
  };

  return {
    messages: data?.adminListDlqMessages.edges.map((edge) => edge.node) ?? [],
    totalCount: data?.adminListDlqMessages.totalCount ?? 0,
    hasNextPage: data?.adminListDlqMessages.pageInfo.hasNextPage ?? false,
    loading,
    error,
    loadMore,
    refetch,
  };
}

export function useReplayDlqMessage() {
  return useMutation<ReplayDlqMessageMutation, ReplayDlqMessageMutationVariables>(
    REPLAY_DLQ_MESSAGE,
  );
}

export function useDiscardDlqMessage() {
  return useMutation<DiscardDlqMessageMutation, DiscardDlqMessageMutationVariables>(
    DISCARD_DLQ_MESSAGE,
  );
}
