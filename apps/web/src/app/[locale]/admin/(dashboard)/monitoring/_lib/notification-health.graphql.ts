'use client';

import { gql } from '@roviq/graphql';

export const ADMIN_NOTIFICATION_HEALTH = gql`
  query AdminNotificationHealth {
    adminNotificationHealth {
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
      messagesPerSecond
    }
  }
`;

export const ADMIN_UPDATE_SENDER_RATE = gql`
  mutation AdminUpdateSenderRate($id: ID!, $messagesPerSecond: Int!) {
    adminUpdateMessagingSender(id: $id, input: { messagesPerSecond: $messagesPerSecond }) {
      id
      messagesPerSecond
    }
  }
`;
