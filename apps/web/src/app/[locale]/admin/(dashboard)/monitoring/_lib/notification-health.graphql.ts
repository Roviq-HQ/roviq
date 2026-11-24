'use client';

import { gql } from '@roviq/graphql';

export const ADMIN_NOTIFICATION_HEALTH = gql`
  query AdminNotificationHealth {
    adminNotificationHealth {
      metricsAvailable
      checkedAt
      channels {
        channel
        sent24h
        failed24h
      }
      canary {
        channel
        lastSuccessAt
      }
    }
  }
`;

export const ADMIN_MONITORING_SENDERS = gql`
  query AdminMonitoringSenders {
    adminMessagingSenders {
      id
      scope
      tenantId
      displayNumber
      status
    }
  }
`;
