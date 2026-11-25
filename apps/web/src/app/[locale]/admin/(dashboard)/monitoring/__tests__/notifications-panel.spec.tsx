import type { MockedResponse } from '@apollo/client/testing';
import type { NotificationChannel } from '@roviq/graphql/generated';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphQLError } from 'graphql';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import { CANARY_LATE_MS, NotificationsPanel } from '../_components/notifications-panel';
import {
  AdminMonitoringSendersDocument,
  type AdminMonitoringSendersQuery,
  AdminNotificationHealthDocument,
  type AdminNotificationHealthQuery,
  AdminUpdateSenderRateDocument,
} from '../_lib/notification-health.graphql.generated';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { adminMonitoring: ids } = testIds;

const CHECKED_AT = '2026-11-24T10:00:00.000Z';
const minutesBefore = (m: number) => new Date(Date.parse(CHECKED_AT) - m * 60 * 1000).toISOString();
const CHANNELS: NotificationChannel[] = ['EMAIL', 'PUSH', 'SMS', 'WHATSAPP'];

function health(options: {
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
          checkedAt: CHECKED_AT,
          channels: CHANNELS.map((channel) => {
            const [sent, failed] = options.counts?.[channel] ?? [0, 0];
            return {
              __typename: 'NotificationChannelHealth',
              channel,
              sent24h: sent,
              failed24h: failed,
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
  providerAccountId: 'acct-1',
  status: 'ACTIVE',
  messagesPerSecond: 10,
};
const BLOCKED_SENDER: AdminMonitoringSendersQuery['adminMessagingSenders'][number] = {
  __typename: 'AdminMessagingSender',
  id: 'sender-institute',
  scope: 'institute',
  tenantId: 'inst-1',
  displayNumber: '+919800000002',
  providerAccountId: null,
  status: 'BLOCKED',
  messagesPerSecond: 1,
};

describe('NotificationsPanel', () => {
  it('should show the counts per channel and the canary, late past its window', async () => {
    renderWithProviders(<NotificationsPanel />, {
      apolloMocks: [
        health({
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

    const blocked = await screen.findByTestId(ids.notificationsSender('sender-institute'));
    expect(blocked).toHaveTextContent('+919800000002');
    expect(blocked).toHaveTextContent('Institute');
    expect(blocked).toHaveTextContent('Blocked');
    expect(screen.getByTestId(ids.notificationsSender('sender-platform'))).toHaveTextContent(
      'Active',
    );
    expect(screen.getByTestId(ids.notificationsSenderRate('sender-platform'))).toHaveTextContent(
      '10 messages a second',
    );
    expect(screen.getByTestId(ids.notificationsSenderRate('sender-institute'))).toHaveTextContent(
      '1 message a second',
    );
  });

  it('should say no sender is registered when the list is empty', async () => {
    renderWithProviders(<NotificationsPanel />, {
      apolloMocks: [health({}), senders([])],
    });

    expect(await screen.findByTestId(ids.notificationsSendersEmpty)).toHaveTextContent(
      'No WhatsApp senders are registered.',
    );
    expect(await screen.findAllByText('Not sent')).toHaveLength(4);
  });

  it('should leave the senders out without read MessagingSender', async () => {
    renderWithProviders(<NotificationsPanel />, {
      apolloMocks: [health({})],
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
      apolloMocks: [health({}), senders([])],
      locale: 'hi',
    });

    expect(await screen.findByText('सूचना वितरण')).toBeInTheDocument();
    expect(await screen.findAllByText('नहीं भेजा गया')).toHaveLength(4);
  });

  describe('messages per second', () => {
    const rateMock = (
      messagesPerSecond: number,
      outcome: { errorCode: string } | null = null,
    ): MockedResponse => ({
      request: {
        query: AdminUpdateSenderRateDocument,
        variables: { id: 'sender-platform', messagesPerSecond },
      },
      result:
        outcome === null
          ? {
              data: {
                adminUpdateMessagingSender: {
                  __typename: 'AdminMessagingSender',
                  id: 'sender-platform',
                  messagesPerSecond,
                },
              },
            }
          : { errors: [new GraphQLError('x', { extensions: { code: outcome.errorCode } })] },
    });

    async function openDialog(apolloMocks: MockedResponse[]) {
      const user = userEvent.setup();
      renderWithProviders(<NotificationsPanel />, {
        apolloMocks: [
          health({}),
          senders([PLATFORM_SENDER]),
          ...apolloMocks,
          senders([PLATFORM_SENDER]),
        ],
      });
      await user.click(
        await screen.findByTestId(ids.notificationsSenderRateEdit('sender-platform')),
      );
      const input = await screen.findByTestId(ids.senderRateInput);
      return { user, input };
    }

    it('should hide the change button without update MessagingSender', async () => {
      renderWithProviders(<NotificationsPanel />, {
        apolloMocks: [health({}), senders([PLATFORM_SENDER])],
        abilityRules: [
          { action: 'read', subject: 'SystemHealth' },
          { action: 'read', subject: 'MessagingSender' },
        ],
      });

      expect(
        await screen.findByTestId(ids.notificationsSenderRate('sender-platform')),
      ).toBeVisible();
      expect(
        screen.queryByTestId(ids.notificationsSenderRateEdit('sender-platform')),
      ).not.toBeInTheDocument();
    });

    it('should open with the current rate and save a new one', async () => {
      const { user, input } = await openDialog([rateMock(80)]);

      expect(input).toHaveValue(10);
      await user.clear(input);
      await user.type(input, '80');
      await user.click(screen.getByTestId(ids.senderRateSave));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Messages per second saved'));
      await waitFor(() =>
        expect(screen.queryByTestId(ids.senderRateDialog)).not.toBeInTheDocument(),
      );
    });

    it.each(['0', '1001', '2.5'])('should refuse %s before sending it', async (typed) => {
      const { user, input } = await openDialog([]);

      await user.clear(input);
      await user.type(input, typed);

      expect(await screen.findByText('Enter a whole number from 1 to 1000.')).toBeInTheDocument();
      expect(screen.getByTestId(ids.senderRateSave)).toBeDisabled();
    });

    it.each([
      ['VALIDATION_FAILED', 'The rate must be a whole number from 1 to 1000.'],
      ['MESSAGING_SENDER_NOT_FOUND', 'This sender no longer exists. Refresh the page.'],
      ['FORBIDDEN', 'You are not allowed to change senders.'],
      ['INTERNAL_SERVER_ERROR', 'The rate could not be saved. Try again.'],
    ])('should show the copy for %s and keep the dialog open', async (errorCode, copy) => {
      const { user, input } = await openDialog([rateMock(20, { errorCode })]);

      await user.clear(input);
      await user.type(input, '20');
      await user.click(screen.getByTestId(ids.senderRateSave));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy));
      expect(screen.getByTestId(ids.senderRateDialog)).toBeInTheDocument();
    });
  });
});
