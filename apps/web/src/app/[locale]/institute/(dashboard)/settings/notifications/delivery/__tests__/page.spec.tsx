import type { RawRuleOf } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import type { NotificationDeliveryLogFilterInput } from '@roviq/graphql/generated';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { GraphQLError } from 'graphql';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import NotificationDeliveryPage from '../page';
import type { DeliveryLogEntry } from '../use-notification-delivery-log';
import { NOTIFICATION_DELIVERY_LOG_QUERY } from '../use-notification-delivery-log';

const ids = testIds.notificationDelivery;

const SESSION_ID = '0195f3a0-0000-7000-8000-000000000001';
const STUDENT_ID = '0195f3a0-0000-7000-8000-000000000002';

const ENTRY: DeliveryLogEntry = {
  __typename: 'NotificationDeliveryLogEntry',
  id: 'entry-1',
  type: 'ATTENDANCE_ABSENT',
  module: 'ATTENDANCE',
  critical: false,
  at: '2026-11-20T03:30:00.000Z',
  studentMembershipId: STUDENT_ID,
  studentFirstName: { en: 'Aarav' },
  studentLastName: { en: 'Sharma' },
  recipientUserId: 'user-1',
  recipientFirstName: { en: 'Rakesh' },
  recipientLastName: { en: 'Sharma' },
  relationship: 'FATHER',
  channels: [
    {
      __typename: 'NotificationDeliveryChannelState',
      channel: 'PUSH',
      state: 'READ',
      reason: null,
      at: '2026-11-20T03:31:00.000Z',
    },
    {
      __typename: 'NotificationDeliveryChannelState',
      channel: 'WHATSAPP',
      state: 'SKIPPED',
      reason: 'no_consent',
      at: '2026-11-20T03:30:00.000Z',
    },
    {
      __typename: 'NotificationDeliveryChannelState',
      channel: 'SMS',
      state: 'FAILED',
      reason: 'SOME_PROVIDER_CODE',
      at: '2026-11-20T03:32:00.000Z',
    },
  ],
};

function logMock(filter: NotificationDeliveryLogFilterInput, entries: DeliveryLogEntry[]) {
  return {
    request: { query: NOTIFICATION_DELIVERY_LOG_QUERY, variables: { filter, first: 25 } },
    result: {
      data: {
        notificationDeliveryLog: {
          __typename: 'NotificationDeliveryLogConnection',
          edges: entries.map((node) => ({
            __typename: 'NotificationDeliveryLogEdge',
            cursor: node.id,
            node,
          })),
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
          totalCount: entries.length,
        },
      },
    },
  };
}

function errorMock(filter: NotificationDeliveryLogFilterInput, code: string) {
  return {
    request: { query: NOTIFICATION_DELIVERY_LOG_QUERY, variables: { filter, first: 25 } },
    result: { errors: [new GraphQLError('denied', { extensions: { code } })] },
  };
}

type Mock = ReturnType<typeof logMock> | ReturnType<typeof errorMock>;

function renderPage(
  mocks: Mock[],
  { search = '', abilityRules }: { search?: string; abilityRules?: RawRuleOf<AppAbility>[] } = {},
) {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
  renderWithProviders(
    <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate} hasMemory>
      <NotificationDeliveryPage />
    </NuqsTestingAdapter>,
    { apolloMocks: mocks, abilityRules },
  );
  return { onUrlUpdate };
}

function lastQuery(onUrlUpdate: ReturnType<typeof renderPage>['onUrlUpdate']): string {
  return onUrlUpdate.mock.lastCall?.[0].queryString ?? '';
}

describe('notification delivery page', () => {
  it('shows each channel state, a dash for an untried channel, and reasons in plain words', async () => {
    renderPage([logMock({}, [ENTRY])]);

    const push = await screen.findByTestId(ids.channelCell(ENTRY.id, 'PUSH'));
    expect(push).toHaveTextContent('Read');

    expect(screen.getByTestId(ids.channelCell(ENTRY.id, 'WHATSAPP'))).toHaveTextContent('Not sent');
    expect(screen.getByTestId(ids.reason(ENTRY.id, 'WHATSAPP'))).toHaveTextContent(
      'The guardian has not agreed to messages on this channel',
    );

    expect(screen.getByTestId(ids.channelCell(ENTRY.id, 'SMS'))).toHaveTextContent('Failed');
    expect(screen.getByTestId(ids.reason(ENTRY.id, 'SMS'))).toHaveTextContent(
      'Could not be delivered; we are looking into it',
    );
    expect(screen.queryByText('SOME_PROVIDER_CODE')).not.toBeInTheDocument();

    expect(screen.getByTestId(ids.channelCell(ENTRY.id, 'EMAIL'))).toHaveTextContent('—');
    expect(screen.queryByTestId(ids.reason(ENTRY.id, 'PUSH'))).not.toBeInTheDocument();

    const table = screen.getByTestId(ids.table);
    expect(within(table).getAllByText('Absent or late').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Aarav Sharma').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Rakesh Sharma').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Father').length).toBeGreaterThan(0);
  });

  it('sends the session from the URL to the query and shows it as a removable chip', async () => {
    const user = userEvent.setup();
    const { onUrlUpdate } = renderPage(
      [logMock({ sessionId: SESSION_ID }, [ENTRY]), logMock({}, [])],
      {
        search: `?sessionId=${SESSION_ID}`,
      },
    );

    expect(await screen.findByTestId(ids.channelCell(ENTRY.id, 'PUSH'))).toBeInTheDocument();
    expect(screen.getByTestId(ids.chip('sessionId'))).toHaveTextContent('One attendance session');

    await user.click(screen.getByTestId(ids.chipRemove('sessionId')));

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(lastQuery(onUrlUpdate)).not.toContain('sessionId');
    expect(await screen.findByTestId(ids.empty)).toBeInTheDocument();
  });

  it('names the student on the chip once their rows are loaded', async () => {
    renderPage([logMock({ studentId: STUDENT_ID }, [ENTRY])], {
      search: `?studentId=${STUDENT_ID}`,
    });

    expect(screen.getByTestId(ids.chip('studentId'))).toHaveTextContent('One student');
    await waitFor(() =>
      expect(screen.getByTestId(ids.chip('studentId'))).toHaveTextContent('Student: Aarav Sharma'),
    );
  });

  it('reads filters from the URL into the query', async () => {
    renderPage(
      [
        logMock({ module: 'FEE', state: 'FAILED', criticalOnly: true, notDeliveredOnly: true }, [
          ENTRY,
        ]),
      ],
      { search: '?module=FEE&state=FAILED&critical=true&notDelivered=true' },
    );

    expect(await screen.findByTestId(ids.channelCell(ENTRY.id, 'PUSH'))).toBeInTheDocument();
    expect(screen.getByTestId(ids.criticalOnlySwitch)).toBeChecked();
    expect(screen.getByTestId(ids.notDeliveredOnlySwitch)).toBeChecked();
  });

  it('writes a filter to the URL and queries with it', async () => {
    const user = userEvent.setup();
    const { onUrlUpdate } = renderPage([
      logMock({}, [ENTRY]),
      logMock({ notDeliveredOnly: true }, []),
    ]);

    await screen.findByTestId(ids.channelCell(ENTRY.id, 'PUSH'));
    await user.click(screen.getByTestId(ids.notDeliveredOnlySwitch));

    await waitFor(() => expect(lastQuery(onUrlUpdate)).toContain('notDelivered=true'));
    const empty = await screen.findByTestId(ids.empty);
    expect(within(empty).getByText('No notifications match these filters')).toBeInTheDocument();
  });

  it('shows the empty state when nothing was sent', async () => {
    renderPage([logMock({}, [])]);

    const empty = await screen.findByTestId(ids.empty);
    expect(within(empty).getByText('No notifications sent yet')).toBeInTheDocument();
    expect(screen.getByTestId(ids.exportBtn)).toBeDisabled();
  });

  it('shows translated copy for an error code, never the server message', async () => {
    renderPage([errorMock({}, 'FORBIDDEN')]);

    const error = await screen.findByTestId(ids.error);
    expect(error).toHaveTextContent('You do not have access to notification delivery.');
    expect(screen.queryByText('denied')).not.toBeInTheDocument();
  });

  it('is not offered without the read ability', () => {
    renderPage([], { abilityRules: [{ action: 'read', subject: 'Student' }] });

    expect(screen.getByTestId(ids.accessDenied)).toBeInTheDocument();
    expect(screen.queryByTestId(ids.table)).not.toBeInTheDocument();
  });
});
