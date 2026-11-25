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
      providerAccountId
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

export const ADMIN_MESSAGING_TEMPLATES = gql`
  query AdminMessagingTemplates($senderId: ID!) {
    adminMessagingTemplates(senderId: $senderId) {
      name
      language
      status
      declaredCategory
      approvedCategory
      rejectedReason
      outOfStep
      sendable
    }
  }
`;

export const ADMIN_SYNC_WHATSAPP_TEMPLATES = gql`
  mutation AdminSyncWhatsAppTemplates($senderId: ID!) {
    adminSyncWhatsAppTemplates(senderId: $senderId)
  }
`;
