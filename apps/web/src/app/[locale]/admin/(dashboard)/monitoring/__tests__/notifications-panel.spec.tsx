import type { MockedResponse } from '@apollo/client/testing';
import type { NotificationChannel } from '@roviq/graphql/generated';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import { GraphQLError } from 'graphql';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import { CANARY_LATE_MS, NotificationsPanel } from '../_components/notifications-panel';
import {
  AdminMonitoringSendersDocument,
  type AdminMonitoringSendersQuery,
  AdminNotificationHealthDocument,
  type AdminNotificationHealthQuery,
} from '../_lib/notification-health.graphql.generated';

const { adminMonitoring: ids } = testIds;

const CHECKED_AT = '2026-11-24T10:00:00.000Z';
const minutesBefore = (m: number) => new Date(Date.parse(CHECKED_AT) - m * 60 * 1000).toISOString();
const CHANNELS: NotificationChannel[] = ['EMAIL', 'PUSH', 'SMS', 'WHATSAPP'];

function health(options: {
  metricsAvailable: boolean;
  counts?: Partial<Record<NotificationChannel, [number, number]>>;
  canary?: Partial<Record<NotificationChannel, string>>;
}): MockedResponse<AdminNotificationHealthQuery> {
  return {
    request: { query: AdminNotificationHealthDocument },
    result: {
      data: {
        __typename: 'Query',
        adminNotificationHealth: {
          __typename: 'NotificationHealth',
          metricsAvailable: options.metricsAvailable,
          checkedAt: CHECKED_AT,
          channels: CHANNELS.map((channel) => {
            const [sent, failed] = options.counts?.[channel] ?? [0, 0];
            return {
              __typename: 'NotificationChannelHealth',
              channel,
              sent24h: options.metricsAvailable ? sent : null,
              failed24h: options.metricsAvailable ? failed : null,
            };
          }),
          canary: CHANNELS.map((channel) => ({
            __typename: 'NotificationCanaryStatus',
            channel,
            lastSuccessAt: options.canary?.[channel] ?? null,
          })),
        },
      },
    },
  };
}

function senders(
  rows: AdminMonitoringSendersQuery['adminMessagingSenders'],
): MockedResponse<AdminMonitoringSendersQuery> {
  return {
    request: { query: AdminMonitoringSendersDocument },
    result: { data: { __typename: 'Query', adminMessagingSenders: rows } },
  };
}

const PLATFORM_SENDER: AdminMonitoringSendersQuery['adminMessagingSenders'][number] = {
  __typename: 'AdminMessagingSender',
  id: 'sender-platform',
  scope: 'platform',
  tenantId: null,
  displayNumber: '+919800000001',
  status: 'ACTIVE',
};
const BLOCKED_SENDER: AdminMonitoringSendersQuery['adminMessagingSenders'][number] = {
  __typename: 'AdminMessagingSender',
  id: 'sender-institute',
  scope: 'institute',
  tenantId: 'inst-1',
  displayNumber: '+919800000002',
  status: 'BLOCKED',
};

describe('NotificationsPanel', () => {
  it('should show the counts per channel and the canary, late past its window', async () => {
    renderWithProviders(<NotificationsPanel />, {
      apolloMocks: [
        health({
          metricsAvailable: true,
          counts: { EMAIL: [1250, 3], WHATSAPP: [40, 0] },
          canary: { EMAIL: minutesBefore(5), WHATSAPP: minutesBefore(CANARY_LATE_MS / 60000 + 15) },
        }),
        senders([PLATFORM_SENDER, BLOCKED_SENDER]),
      ],
    });

    const email = await screen.findByTestId(ids.notificationsChannel('EMAIL'));
    expect(within(email).getByText('Email')).toBeInTheDocument();
    expect(within(email).getByText('1,250')).toBeInTheDocument();
    expect(within(email).getByText('3')).toBeInTheDocument();
    expect(within(email).getByText(/^Accepted/)).toBeInTheDocument();
    const whatsapp = screen.getByTestId(ids.notificationsChannel('WHATSAPP'));
    expect(within(whatsapp).getByText(/^Late: last accepted/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId(ids.notificationsChannel('SMS'))).getByText('Not sent'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(ids.notificationsMetricsUnavailable)).not.toBeInTheDocument();

    const blocked = await screen.findByTestId(ids.notificationsSender('sender-institute'));
    expect(blocked).toHaveTextContent('+919800000002');
    expect(blocked).toHaveTextContent('Institute');
    expect(blocked).toHaveTextContent('Blocked');
    expect(screen.getByTestId(ids.notificationsSender('sender-platform'))).toHaveTextContent(
      'Active',
    );
  });

  it('should say the counts are unavailable rather than zero when OpenObserve is down', async () => {
    renderWithProviders(<NotificationsPanel />, {
      apolloMocks: [
        health({ metricsAvailable: false, canary: { EMAIL: minutesBefore(5) } }),
        senders([]),
      ],
    });

    expect(await screen.findByTestId(ids.notificationsMetricsUnavailable)).toBeInTheDocument();
    const email = screen.getByTestId(ids.notificationsChannel('EMAIL'));
    expect(within(email).getAllByText('—')).toHaveLength(2);
    expect(within(email).getByText(/^Accepted/)).toBeInTheDocument();
  });

  it('should say no sender is registered when the list is empty', async () => {
    renderWithProviders(<NotificationsPanel />, {
      apolloMocks: [health({ metricsAvailable: true }), senders([])],
    });

    expect(await screen.findByTestId(ids.notificationsSendersEmpty)).toHaveTextContent(
      'No WhatsApp senders are registered.',
    );
    expect(await screen.findAllByText('Not sent')).toHaveLength(4);
  });

  it('should leave the senders out without read MessagingSender', async () => {
    renderWithProviders(<NotificationsPanel />, {
      apolloMocks: [health({ metricsAvailable: true })],
      abilityRules: [{ action: 'read', subject: 'SystemHealth' }],
    });

    await screen.findByTestId(ids.notificationsChannel('EMAIL'));
    expect(screen.queryByText('WhatsApp senders')).not.toBeInTheDocument();
  });

  it('should show a retry when the health query fails', async () => {
    renderWithProviders(<NotificationsPanel />, {
      apolloMocks: [
        {
          request: { query: AdminNotificationHealthDocument },
          result: { errors: [new GraphQLError('denied', { extensions: { code: 'FORBIDDEN' } })] },
        },
        senders([]),
      ],
    });

    expect(await screen.findByTestId(ids.notificationsError)).toBeInTheDocument();
    expect(screen.getByTestId(ids.notificationsRetryBtn)).toBeInTheDocument();
  });

  it('should render in Hindi', async () => {
    renderWithProviders(<NotificationsPanel />, {
      apolloMocks: [health({ metricsAvailable: true }), senders([])],
      locale: 'hi',
    });

    expect(await screen.findByText('सूचना वितरण')).toBeInTheDocument();
    expect(await screen.findAllByText('नहीं भेजा गया')).toHaveLength(4);
  });
});
