'use client';

import { gql, useMutation, useQuery } from '@roviq/graphql';

// --- Types ---

export interface SubscriptionNode {
  id: string;
  organization: {
    id: string;
    name: string;
  };
  plan: {
    id: string;
    name: string;
    amount: number;
    currency: string;
    billingInterval: string;
  };
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'PENDING_PAYMENT' | 'PAUSED' | 'COMPLETED';
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  trialEndsAt: string | null;
  createdAt: string;
}

interface SubscriptionEdge {
  cursor: string;
  node: SubscriptionNode;
}

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  endCursor: string | null;
  startCursor: string | null;
}

interface SubscriptionsData {
  subscriptions: {
    edges: SubscriptionEdge[];
    totalCount: number;
    pageInfo: PageInfo;
  };
}

interface SubscriptionsVariables {
  filter?: {
    status?: string;
  };
  first?: number;
  after?: string;
}

interface AssignPlanResult {
  subscription: { id: string; status: string };
  checkoutUrl: string | null;
}

interface AssignPlanData {
  assignPlanToOrganization: AssignPlanResult;
}

interface AssignPlanInput {
  organizationId: string;
  planId: string;
  provider: 'CASHFREE' | 'RAZORPAY';
  customerEmail: string;
  customerPhone: string;
}

// --- Queries ---

const SUBSCRIPTIONS_QUERY = gql`
  query Subscriptions($filter: SubscriptionFilterInput, $first: Int, $after: String) {
    subscriptions(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          organization {
            id
            name
          }
          plan {
            id
            name
            amount
            currency
            billingInterval
          }
          status
          providerSubscriptionId
          providerCustomerId
          currentPeriodStart
          currentPeriodEnd
          canceledAt
          trialEndsAt
          createdAt
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
`;

const ASSIGN_PLAN_MUTATION = gql`
  mutation AssignPlanToOrganization($input: AssignPlanInput!) {
    assignPlanToOrganization(input: $input) {
      subscription {
        id
        status
      }
      checkoutUrl
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = gql`
  mutation CancelSubscription($input: ManageSubscriptionInput!) {
    cancelSubscription(input: $input) {
      id
      status
    }
  }
`;

const PAUSE_SUBSCRIPTION_MUTATION = gql`
  mutation PauseSubscription($subscriptionId: ID!) {
    pauseSubscription(subscriptionId: $subscriptionId) {
      id
      status
    }
  }
`;

const RESUME_SUBSCRIPTION_MUTATION = gql`
  mutation ResumeSubscription($subscriptionId: ID!) {
    resumeSubscription(subscriptionId: $subscriptionId) {
      id
      status
    }
  }
`;

// --- Hooks ---

export function useSubscriptions(variables: SubscriptionsVariables) {
  const { data, loading, error, fetchMore } = useQuery<SubscriptionsData, SubscriptionsVariables>(
    SUBSCRIPTIONS_QUERY,
    {
      variables,
      notifyOnNetworkStatusChange: true,
    },
  );

  const loadMore = () => {
    const endCursor = data?.subscriptions.pageInfo.endCursor;
    if (!endCursor) return;
    return fetchMore({ variables: { ...variables, after: endCursor } });
  };

  return {
    subscriptions: data?.subscriptions.edges.map((e) => e.node) ?? [],
    totalCount: data?.subscriptions.totalCount ?? 0,
    hasNextPage: data?.subscriptions.pageInfo.hasNextPage ?? false,
    loading,
    error,
    loadMore,
  };
}

export function useAssignPlan() {
  return useMutation<AssignPlanData, { input: AssignPlanInput }>(ASSIGN_PLAN_MUTATION, {
    refetchQueries: ['Subscriptions'],
  });
}

export function useCancelSubscription() {
  return useMutation<
    { cancelSubscription: { id: string; status: string } },
    { input: { subscriptionId: string; atCycleEnd?: boolean } }
  >(CANCEL_SUBSCRIPTION_MUTATION, {
    refetchQueries: ['Subscriptions'],
    awaitRefetchQueries: true,
  });
}

export function usePauseSubscription() {
  return useMutation<
    { pauseSubscription: { id: string; status: string } },
    { subscriptionId: string }
  >(PAUSE_SUBSCRIPTION_MUTATION, {
    refetchQueries: ['Subscriptions'],
    awaitRefetchQueries: true,
  });
}

export function useResumeSubscription() {
  return useMutation<
    { resumeSubscription: { id: string; status: string } },
    { subscriptionId: string }
  >(RESUME_SUBSCRIPTION_MUTATION, {
    refetchQueries: ['Subscriptions'],
    awaitRefetchQueries: true,
  });
}
