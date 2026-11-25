'use client';

import { gql } from '@roviq/graphql';

const SYSTEM_HEALTH_FIELDS = gql`
  fragment SystemHealthFields on SystemHealth {
    services {
      name
      status
      responseMs
      uptimePercent
      checkedAt
    }
    natsStreams {
      name
      consumerLag
    }
    connections {
      websocket
      http
    }
    alerts {
      name
      severity
      message
      since
      runbook
      stillTrue
      affected {
        label
        value
      }
    }
    alertsAvailable
    dlqPendingCount
    checkedAt
  }
`;

export const ADMIN_SYSTEM_HEALTH = gql`
  query AdminSystemHealth {
    adminSystemHealth {
      ...SystemHealthFields
    }
  }
  ${SYSTEM_HEALTH_FIELDS}
`;

export const ADMIN_SYSTEM_HEALTH_UPDATED = gql`
  subscription AdminSystemHealthUpdated {
    adminSystemHealthUpdated {
      ...SystemHealthFields
    }
  }
  ${SYSTEM_HEALTH_FIELDS}
`;

export const ADMIN_CONNECTION_METRICS = gql`
  query AdminConnectionMetrics {
    adminConnectionMetrics {
      websocket
      http
    }
  }
`;
