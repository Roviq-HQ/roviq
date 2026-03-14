'use client';

import { gql, useQuery } from '@roviq/graphql';

// --- Types ---

export interface InvoiceNode {
  id: string;
  subscription: {
    id: string;
    organization: {
      id: string;
      name: string;
    };
  };
  amount: number;
  currency: string;
  status: 'PAID' | 'PENDING' | 'OVERDUE' | 'FAILED' | 'REFUNDED';
  providerInvoiceId: string | null;
  providerPaymentId: string | null;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate: string;
  paidAt: string | null;
  createdAt: string;
}

interface InvoiceEdge {
  cursor: string;
  node: InvoiceNode;
}

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  endCursor: string | null;
  startCursor: string | null;
}

interface InvoicesData {
  invoices: {
    edges: InvoiceEdge[];
    totalCount: number;
    pageInfo: PageInfo;
  };
}

interface InvoicesVariables {
  organizationId?: string;
  filter?: {
    status?: string;
  };
  first?: number;
  after?: string;
}

// --- Queries ---

const INVOICES_QUERY = gql`
  query Invoices($organizationId: ID, $filter: BillingFilterInput, $first: Int, $after: String) {
    invoices(organizationId: $organizationId, filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          subscription {
            id
            organization {
              id
              name
            }
          }
          amount
          currency
          status
          providerInvoiceId
          providerPaymentId
          billingPeriodStart
          billingPeriodEnd
          dueDate
          paidAt
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

// --- Hook ---

export function useInvoices(variables: InvoicesVariables) {
  const { data, loading, error, fetchMore } = useQuery<InvoicesData, InvoicesVariables>(
    INVOICES_QUERY,
    {
      variables,
      notifyOnNetworkStatusChange: true,
    },
  );

  const loadMore = () => {
    const endCursor = data?.invoices.pageInfo.endCursor;
    if (!endCursor) return;
    return fetchMore({ variables: { ...variables, after: endCursor } });
  };

  return {
    invoices: data?.invoices.edges.map((e) => e.node) ?? [],
    totalCount: data?.invoices.totalCount ?? 0,
    hasNextPage: data?.invoices.pageInfo.hasNextPage ?? false,
    loading,
    error,
    loadMore,
  };
}
