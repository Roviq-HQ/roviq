'use client';

import { gql } from '@roviq/graphql';

export const ADMIN_TENANT_ANALYTICS = gql`
  query AdminTenantAnalytics(
    $first: Int!
    $after: String
    $sortBy: TenantAnalyticsSortField!
    $sortOrder: SortOrder!
    $resellerId: ID
  ) {
    adminTenantAnalytics(
      first: $first
      after: $after
      sortBy: $sortBy
      sortOrder: $sortOrder
      resellerId: $resellerId
    ) {
      edges {
        cursor
        node {
          instituteId
          instituteName
          resellerId
          resellerName
          activeUsers24h
          apiCalls24h
          activityTrend7d
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
      metricsAvailable
    }
  }
`;

export const ADMIN_MONITORING_RESELLERS = gql`
  query AdminMonitoringResellers {
    adminListResellers(filter: { first: 100 }) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;
