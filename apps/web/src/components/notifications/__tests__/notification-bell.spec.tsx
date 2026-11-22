import { ApolloLink } from '@apollo/client';
import { MockLink, MockSubscriptionLink } from '@apollo/client/testing';
import { getMainDefinition } from '@apollo/client/utilities';
import type { Locale } from '@roviq/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { GraphQLError } from 'graphql';
import { from, mergeMap, tap } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '../notification-bell';
import {
  MarkAllNotificationsReadDocument,
  MarkNotificationReadDocument,
  MyNotificationsDocument,
  MyUnreadNotificationCountDocument,
} from '../notification-bell.generated';

const auth = vi.hoisted(() => ({
  scope: 'institute' as 'institute' | 'reseller' | 'platform',
  isImpersonated: false,
}));
vi.mock('@roviq/auth', () => ({
  useAuth: () => ({ scope: auth.scope, isImpersonated: auth.isImpersonated }),
}));

const push = vi.hoisted(() => vi.fn());
vi.mock('@roviq/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/i18n')>()),
  useRouter: () => ({ push }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const FIVE_MINUTES_AGO = new Date(Date.now() - 5 * 60_000).toISOString();

function notification(id: string, overrides: { readAt?: string | null; path?: unknown } = {}) {
  return {
    __typename: 'NotificationModel' as const,
    id,
    type: 'ATTENDANCE_ABSENT',
    title: { en: `Ishaan Kapoor was absent (${id})`, hi: `ईशान कपूर अनुपस्थित रहे (${id})` },
    body: { en: 'Marked absent in Nursery-A today.', hi: 'आज नर्सरी-A में अनुपस्थित दर्ज किया गया।' },
    data: { path: 'path' in overrides ? overrides.path : '/institute/attendance' },
    readAt: overrides.readAt ?? null,
    createdAt: FIVE_MINUTES_AGO,
  };
}

type Node = ReturnType<typeof notification>;

function countMock(count: number, uses = Number.POSITIVE_INFINITY) {
  return {
    request: { query: MyUnreadNotificationCountDocument },
    maxUsageCount: uses,
    result: { data: { __typename: 'Query' as const, myUnreadNotificationCount: count } },
  };
}

function listMock(
  nodes: Node[],
  page: { after?: string; endCursor?: string; onCall?: () => void } = {},
) {
  return {
    request: {
      query: MyNotificationsDocument,
      variables: page.after ? { first: 20, after: page.after } : { first: 20 },
    },
    result: () => {
      page.onCall?.();
      return {
        data: {
          __typename: 'Query' as const,
          myNotifications: {
            __typename: 'NotificationConnection' as const,
            edges: nodes.map((node) => ({
              __typename: 'NotificationEdge' as const,
              cursor: `cursor-${node.id}`,
              node,
            })),
            pageInfo: {
              __typename: 'PageInfo' as const,
              hasNextPage: Boolean(page.endCursor),
              endCursor: page.endCursor ?? null,
            },
          },
        },
      };
    },
  };
}

function markReadMock(id: string, onCall?: () => void) {
  return {
    request: { query: MarkNotificationReadDocument, variables: { id } },
    result: () => {
      onCall?.();
      return {
        data: {
          __typename: 'Mutation' as const,
          markNotificationRead: {
            __typename: 'NotificationModel' as const,
            id,
            readAt: new Date().toISOString(),
          },
        },
      };
    },
  };
}

function markReadError(id: string, code: string) {
  return {
    request: { query: MarkNotificationReadDocument, variables: { id } },
    result: { errors: [new GraphQLError('refused', { extensions: { code } })] },
  };
}

let countResponses = 0;

function renderBell(
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  options: { locale?: Locale; holdList?: Promise<void> } = {},
) {
  const subscriptions = new MockSubscriptionLink();
  countResponses = 0;
  const { holdList } = options;
  const control = new ApolloLink((operation, forward) => {
    const response =
      holdList && operation.operationName === 'MyNotifications'
        ? from(holdList).pipe(mergeMap(() => forward(operation)))
        : forward(operation);
    return response.pipe(
      tap({
        complete: () => {
          if (operation.operationName === 'MyUnreadNotificationCount') countResponses += 1;
        },
      }),
    );
  });
  const link = ApolloLink.split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
    },
    subscriptions,
    ApolloLink.from([control, new MockLink(mocks)]),
  );
  renderWithProviders(<NotificationBell />, { apolloLink: link, locale: options.locale });
  return subscriptions;
}

const bell = () => screen.getByTestId('notification-bell');
const badge = () => screen.queryByTestId('notification-bell-badge');

// Opening refetches the count; waiting for that answer keeps it from landing after a later
// local change (mark read, live event) and overwriting it.
async function openPanel() {
  await waitFor(() => expect(countResponses).toBeGreaterThan(0));
  const before = countResponses;
  await userEvent.click(bell());
  await waitFor(() => expect(countResponses).toBe(before + 1));
}

beforeEach(() => {
  auth.scope = 'institute';
  auth.isImpersonated = false;
  push.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NotificationBell badge', () => {
  it('hides the badge at 0 and names the bell without a count', async () => {
    renderBell([countMock(0)]);

    await waitFor(() => expect(bell()).toHaveAccessibleName('Notifications'));
    expect(badge()).not.toBeInTheDocument();
  });

  it('shows 5 and puts the count in the accessible name', async () => {
    renderBell([countMock(5)]);

    await waitFor(() => expect(badge()).toHaveTextContent('5'));
    expect(bell()).toHaveAccessibleName('Notifications, 5 unread');
  });

  it('caps the badge at 99+ above 99', async () => {
    renderBell([countMock(120)]);

    await waitFor(() => expect(badge()).toHaveTextContent('99+'));
    expect(bell()).toHaveAccessibleName('Notifications, 120 unread');
  });
});

describe('NotificationBell panel', () => {
  it('lists title, body, relative time and an unread label in English', async () => {
    renderBell([countMock(1), listMock([notification('n1')])]);
    await openPanel();

    const item = await screen.findByTestId('notification-item-n1');
    expect(item).toHaveTextContent('Ishaan Kapoor was absent (n1)');
    expect(item).toHaveTextContent('Marked absent in Nursery-A today.');
    expect(item).toHaveTextContent('5 minutes ago');
    expect(within(item).getByText('New')).toBeInTheDocument();
  });

  it('shows the notification text and labels in Hindi', async () => {
    renderBell([countMock(1), listMock([notification('n1')])], { locale: 'hi' });
    await waitFor(() => expect(bell()).toHaveAccessibleName('सूचनाएँ, 1 अपठित'));
    await openPanel();

    const item = await screen.findByTestId('notification-item-n1');
    expect(item).toHaveTextContent('ईशान कपूर अनुपस्थित रहे (n1)');
    expect(item).toHaveTextContent('आज नर्सरी-A में अनुपस्थित दर्ज किया गया।');
    expect(item).toHaveTextContent('५ मिनट पहले');
    expect(within(item).getByText('नई')).toBeInTheDocument();
    expect(screen.getByTestId('notification-mark-all-btn')).toHaveTextContent(
      'सभी को पढ़ा हुआ चिह्नित करें',
    );
  });

  it('shows the loading state, then the empty state', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderBell([countMock(0), listMock([])], { holdList: held });
    await openPanel();

    expect(screen.getByTestId('notification-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('notification-empty')).not.toBeInTheDocument();
    release();
    expect(await screen.findByTestId('notification-empty')).toHaveTextContent(
      'No notifications yet',
    );
    expect(screen.queryByTestId('notification-loading')).not.toBeInTheDocument();
  });

  it('shows an error with a retry that loads the list', async () => {
    renderBell([
      countMock(1),
      {
        request: { query: MyNotificationsDocument, variables: { first: 20 } },
        error: new Error('offline'),
      },
      listMock([notification('n1')]),
    ]);
    await openPanel();

    const error = await screen.findByTestId('notification-error');
    expect(error).toHaveTextContent('Could not load notifications.');
    await userEvent.click(screen.getByTestId('notification-retry-btn'));

    expect(await screen.findByTestId('notification-item-n1')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-error')).not.toBeInTheDocument();
  });

  it('loads the next page with Load more', async () => {
    renderBell([
      countMock(2),
      listMock([notification('n1')], { endCursor: 'cursor-n1' }),
      listMock([notification('n2')], { after: 'cursor-n1' }),
    ]);
    await openPanel();
    await screen.findByTestId('notification-item-n1');

    await userEvent.click(screen.getByTestId('notification-load-more-btn'));

    expect(await screen.findByTestId('notification-item-n2')).toBeInTheDocument();
    expect(screen.getByTestId('notification-item-n1')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-load-more-btn')).not.toBeInTheDocument();
  });

  it('does not mark anything read just by opening', async () => {
    const marked = vi.fn();
    renderBell([countMock(1), listMock([notification('n1')]), markReadMock('n1', marked)]);
    await openPanel();
    await screen.findByTestId('notification-item-n1');

    expect(marked).not.toHaveBeenCalled();
    expect(badge()).toHaveTextContent('1');
  });
});

describe('NotificationBell actions', () => {
  it('opening an item marks it read, drops the badge and goes to its page', async () => {
    const marked = vi.fn();
    renderBell([countMock(1), listMock([notification('n1')]), markReadMock('n1', marked)]);
    await openPanel();
    await userEvent.click(await screen.findByTestId('notification-item-n1'));

    expect(push).toHaveBeenCalledWith('/institute/attendance');
    await waitFor(() => expect(marked).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(badge()).not.toBeInTheDocument());
    expect(bell()).toHaveAccessibleName('Notifications');
  });

  it.each([
    ['an absolute URL', 'https://evil.example/institute/attendance'],
    ['a protocol-relative URL', '//evil.example/institute'],
    ['another portal', '/admin/institutes/123'],
    ['a path that climbs out', '/institute/../admin'],
    ['a non-string', 42],
  ])('does not navigate to %s but still marks it read', async (_label, path) => {
    const marked = vi.fn();
    renderBell([
      countMock(1),
      listMock([notification('n1', { path })]),
      markReadMock('n1', marked),
    ]);
    await openPanel();
    await userEvent.click(await screen.findByTestId('notification-item-n1'));

    await waitFor(() => expect(marked).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });

  it('marks all as read', async () => {
    renderBell([
      countMock(2),
      listMock([notification('n1'), notification('n2')]),
      {
        request: { query: MarkAllNotificationsReadDocument },
        result: { data: { __typename: 'Mutation' as const, markAllNotificationsRead: 2 } },
      },
    ]);
    await openPanel();
    await screen.findByTestId('notification-item-n2');

    await userEvent.click(screen.getByTestId('notification-mark-all-btn'));

    await waitFor(() => expect(badge()).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('2 notifications marked as read');
    expect(
      within(screen.getByTestId('notification-list')).queryByText('New'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('notification-mark-all-btn')).not.toBeInTheDocument();
  });

  it('removes an item quietly when the server says it no longer exists', async () => {
    renderBell([
      countMock(2, 2),
      // No path, so the panel stays open after the click.
      listMock([notification('n1', { path: null }), notification('n2')]),
      markReadError('n1', 'NOTIFICATION_NOT_FOUND'),
      countMock(1),
    ]);
    await openPanel();
    await userEvent.click(await screen.findByTestId('notification-item-n1'));

    await waitFor(() =>
      expect(screen.queryByTestId('notification-item-n1')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('notification-item-n2')).toBeInTheDocument();
    await waitFor(() => expect(badge()).toHaveTextContent('1'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows translated copy when marking fails for another reason', async () => {
    renderBell([
      countMock(1),
      listMock([notification('n1', { path: null })]),
      markReadError('n1', 'INTERNAL_SERVER_ERROR'),
    ]);
    await openPanel();
    await userEvent.click(await screen.findByTestId('notification-item-n1'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Could not mark the notification as read. Please try again.',
      ),
    );
    expect(screen.getByTestId('notification-item-n1')).toBeInTheDocument();
    expect(badge()).toHaveTextContent('1');
  });
});

describe('NotificationBell live and read-only', () => {
  it('a received notification raises the badge and appears at the top', async () => {
    const subscriptions = renderBell([countMock(1), listMock([notification('n1')])]);
    await openPanel();
    await screen.findByTestId('notification-item-n1');
    await waitFor(() => expect(subscriptions.operation).toBeDefined());

    act(() => {
      subscriptions.simulateResult({
        result: { data: { __typename: 'Subscription', notificationReceived: notification('n9') } },
      });
    });

    await waitFor(() => expect(badge()).toHaveTextContent('2'));
    const rows = within(screen.getByTestId('notification-list')).getAllByRole('button');
    expect(rows[0]).toHaveAttribute('data-testid', 'notification-item-n9');
    expect(rows[1]).toHaveAttribute('data-testid', 'notification-item-n1');
  });

  it('raises the badge for a received notification before the panel was ever opened', async () => {
    const subscriptions = renderBell([countMock(3)]);
    await waitFor(() => expect(badge()).toHaveTextContent('3'));
    await waitFor(() => expect(subscriptions.operation).toBeDefined());

    act(() => {
      subscriptions.simulateResult({
        result: { data: { __typename: 'Subscription', notificationReceived: notification('n9') } },
      });
    });

    await waitFor(() => expect(badge()).toHaveTextContent('4'));
  });

  it('opening the panel again re-reads the list and the count from the server', async () => {
    const listCalls = vi.fn();
    renderBell([
      countMock(1, 2),
      listMock([notification('n1')], { onCall: listCalls }),
      listMock([notification('n2'), notification('n1')], { onCall: listCalls }),
      countMock(2),
    ]);
    await openPanel();
    await screen.findByTestId('notification-item-n1');
    expect(listCalls).toHaveBeenCalledTimes(1);
    expect(badge()).toHaveTextContent('1');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument());
    await openPanel();

    expect(countResponses).toBe(3);
    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(2));
    const rows = await waitFor(() => {
      const found = within(screen.getByTestId('notification-list')).getAllByRole('button');
      expect(found).toHaveLength(2);
      return found;
    });
    expect(rows[0]).toHaveAttribute('data-testid', 'notification-item-n2');
    expect(rows[1]).toHaveAttribute('data-testid', 'notification-item-n1');
    await waitFor(() => expect(badge()).toHaveTextContent('2'));
  });

  it('re-reads the count when the page becomes visible again', async () => {
    renderBell([countMock(3, 1), countMock(5, 1)]);
    await waitFor(() => expect(badge()).toHaveTextContent('3'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(badge()).toHaveTextContent('5'));
    expect(countResponses).toBe(2);
  });

  it('re-reads the count when the window regains focus', async () => {
    renderBell([countMock(3, 1), countMock(4, 1)]);
    await waitFor(() => expect(badge()).toHaveTextContent('3'));

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(badge()).toHaveTextContent('4'));
  });

  it('while impersonating: lists and counts, offers no mark controls and says why', async () => {
    auth.isImpersonated = true;
    renderBell([countMock(1), listMock([notification('n1')])]);
    await waitFor(() => expect(badge()).toHaveTextContent('1'));
    await openPanel();
    const item = await screen.findByTestId('notification-item-n1');

    expect(screen.queryByTestId('notification-mark-all-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('notification-read-only-note')).toHaveTextContent(
      'You are viewing as another user, so notifications cannot be marked as read here.',
    );
    // No mark mock exists: a mark request would fail the toast assertion below.
    await userEvent.click(item);
    expect(push).toHaveBeenCalledWith('/institute/attendance');
    expect(toast.error).not.toHaveBeenCalled();
    expect(badge()).toHaveTextContent('1');
  });
});
