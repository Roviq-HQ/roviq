'use client';

import { useAuth } from '@roviq/auth';
import {
  extractGraphQLErrorCode,
  gql,
  useApolloClient,
  useMutation,
  useQuery,
  useSubscription,
} from '@roviq/graphql';
import { useFormatDate, useI18nField, useRouter } from '@roviq/i18n';
import {
  Badge,
  Button,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  useMediaQuery,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Bell, BellOff, CheckCheck, Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import {
  MarkAllNotificationsReadDocument,
  MarkNotificationReadDocument,
  MyNotificationsDocument,
  type MyNotificationsQuery,
  MyUnreadNotificationCountDocument,
  NotificationReceivedDocument,
} from './notification-bell.generated';
import { notificationPath } from './notification-path';

export const MY_NOTIFICATIONS = gql`
  query MyNotifications($first: Int!, $after: String) {
    myNotifications(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          type
          title
          body
          data
          readAt
          createdAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const MY_UNREAD_NOTIFICATION_COUNT = gql`
  query MyUnreadNotificationCount {
    myUnreadNotificationCount
  }
`;

export const MARK_NOTIFICATION_READ = gql`
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id) {
      id
      readAt
    }
  }
`;

export const MARK_ALL_NOTIFICATIONS_READ = gql`
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`;

export const NOTIFICATION_RECEIVED = gql`
  subscription NotificationReceived {
    notificationReceived {
      id
      type
      title
      body
      data
      readAt
      createdAt
    }
  }
`;

export const NOTIFICATION_PAGE_SIZE = 20;

type NotificationEdge = MyNotificationsQuery['myNotifications']['edges'][number];
type NotificationNode = NotificationEdge['node'];

const { notificationBell: ids } = testIds;
const LIST_VARIABLES = { first: NOTIFICATION_PAGE_SIZE };

function mergeEdges(first: NotificationEdge[], second: NotificationEdge[]): NotificationEdge[] {
  const seen = new Set(first.map((edge) => edge.node.id));
  return [...first, ...second.filter((edge) => !seen.has(edge.node.id))];
}

/**
 * Topbar bell for all three portals: unread badge, the signed-in user's notifications for
 * the current scope, and live arrivals through `notificationReceived`.
 */
export function NotificationBell() {
  const t = useTranslations('notificationInbox');
  const { scope, isImpersonated } = useAuth();
  const client = useApolloClient();
  const router = useRouter();
  const isPhone = useMediaQuery('(max-width: 767px)');
  const [open, setOpen] = React.useState(false);
  // The list loads on first open; the badge count loads at once.
  const [opened, setOpened] = React.useState(false);

  const countQuery = useQuery(MyUnreadNotificationCountDocument);
  const unread = countQuery.data?.myUnreadNotificationCount ?? 0;
  const refetchCount = countQuery.refetch;

  // Events missed while the socket was down are picked up here, without polling.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetchCount();
    };
    const onFocus = () => void refetchCount();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refetchCount]);

  const list = useQuery(MyNotificationsDocument, {
    variables: LIST_VARIABLES,
    skip: !opened,
    notifyOnNetworkStatusChange: true,
  });

  const [markRead] = useMutation(MarkNotificationReadDocument);
  const [markAll, { loading: markingAll }] = useMutation(MarkAllNotificationsReadDocument);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const adjustCount = React.useCallback(
    (next: (count: number) => number) => {
      client.cache.updateQuery({ query: MyUnreadNotificationCountDocument }, (prev) =>
        prev
          ? {
              ...prev,
              myUnreadNotificationCount: Math.max(0, next(prev.myUnreadNotificationCount)),
            }
          : prev,
      );
    },
    [client],
  );

  const updateList = React.useCallback(
    (edges: (current: NotificationEdge[]) => NotificationEdge[]) => {
      client.cache.updateQuery(
        { query: MyNotificationsDocument, variables: LIST_VARIABLES },
        (prev) =>
          prev
            ? {
                ...prev,
                myNotifications: {
                  ...prev.myNotifications,
                  edges: edges(prev.myNotifications.edges),
                },
              }
            : prev,
      );
    },
    [client],
  );

  useSubscription(NotificationReceivedDocument, {
    onData: ({ data }) => {
      const node = data.data?.notificationReceived;
      if (!node) return;
      let added = false;
      updateList((edges) => {
        if (edges.some((edge) => edge.node.id === node.id)) return edges;
        added = true;
        // Paging reads only pageInfo.endCursor, so the prepended edge's cursor is never sent.
        return [{ __typename: 'NotificationEdge', cursor: node.id, node }, ...edges];
      });
      const listLoaded = client.cache.readQuery({
        query: MyNotificationsDocument,
        variables: LIST_VARIABLES,
      });
      if (!node.readAt && (added || !listLoaded)) adjustCount((count) => count + 1);
    },
  });

  const openNotification = async (node: NotificationNode) => {
    const path = notificationPath(node.data, scope);
    if (path) {
      setOpen(false);
      router.push(path);
    }
    if (node.readAt || isImpersonated) return;
    try {
      await markRead({ variables: { id: node.id } });
      adjustCount((count) => count - 1);
    } catch (error) {
      if (extractGraphQLErrorCode(error) === 'NOTIFICATION_NOT_FOUND') {
        updateList((edges) => edges.filter((edge) => edge.node.id !== node.id));
        void client.refetchQueries({ include: [MyUnreadNotificationCountDocument] });
        return;
      }
      toast.error(t('markFailed'));
    }
  };

  const markAllRead = async () => {
    try {
      const result = await markAll();
      const now = new Date().toISOString();
      updateList((edges) =>
        edges.map((edge) =>
          edge.node.readAt ? edge : { ...edge, node: { ...edge.node, readAt: now } },
        ),
      );
      adjustCount(() => 0);
      toast.success(t('markAllDone', { count: result.data?.markAllNotificationsRead ?? 0 }));
    } catch {
      toast.error(t('markAllFailed'));
    }
  };

  const loadMore = async () => {
    const after = list.data?.myNotifications.pageInfo.endCursor;
    if (!after) return;
    setLoadingMore(true);
    try {
      await list.fetchMore({
        variables: { after },
        updateQuery: (prev, { fetchMoreResult }) => ({
          ...prev,
          myNotifications: {
            ...fetchMoreResult.myNotifications,
            edges: mergeEdges(prev.myNotifications.edges, fetchMoreResult.myNotifications.edges),
          },
        }),
      });
    } catch {
      toast.error(t('error'));
    } finally {
      setLoadingMore(false);
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    void refetchCount();
    // The first open starts the list query itself; later opens re-read it, showing cached rows meanwhile.
    if (opened) void list.refetch();
    else setOpened(true);
  };

  const edges = list.data?.myNotifications.edges ?? [];
  const body = (
    <PanelBody
      edges={edges}
      loading={list.loading && !list.data}
      failed={Boolean(list.error) && !list.data}
      hasNextPage={list.data?.myNotifications.pageInfo.hasNextPage ?? false}
      loadingMore={loadingMore}
      onRetry={() => void list.refetch()}
      onLoadMore={() => void loadMore()}
      onOpen={(node) => void openNotification(node)}
    />
  );

  const header = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t('title')}</span>
        {!isImpersonated && unread > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={markingAll}
            title={t('markAllRead')}
            data-testid={ids.markAllBtn}
          >
            <CheckCheck className="size-4" aria-hidden />
            {t('markAllRead')}
          </Button>
        )}
      </div>
      {isImpersonated && (
        <p
          className="flex items-start gap-2 text-xs text-muted-foreground"
          data-testid={ids.readOnlyNote}
        >
          <Eye className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('readOnlyNote')}
        </p>
      )}
    </div>
  );

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      aria-label={t('bellLabel', { count: unread })}
      title={t('title')}
      data-testid={ids.trigger}
      onClick={isPhone ? () => onOpenChange(true) : undefined}
    >
      <Bell className="size-4" aria-hidden />
      {unread > 0 && (
        <span
          data-testid={ids.badge}
          aria-hidden
          className="absolute -top-0.5 -end-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Button>
  );

  if (isPhone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            className="flex max-h-[85vh] flex-col gap-0"
            data-testid={ids.panel}
          >
            {/* pe-12 keeps "Mark all as read" clear of the sheet's close button. */}
            <SheetHeader className="border-b pe-12">
              <SheetTitle className="sr-only">{t('title')}</SheetTitle>
              <SheetDescription className="sr-only">{t('title')}</SheetDescription>
              {header}
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="flex max-h-[min(600px,calc(100vh-5rem))] w-[400px] max-w-[calc(100vw-2rem)] flex-col p-0"
        data-testid={ids.panel}
        aria-label={t('title')}
      >
        <div className="border-b p-3">{header}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      </PopoverContent>
    </Popover>
  );
}

function PanelBody({
  edges,
  loading,
  failed,
  hasNextPage,
  loadingMore,
  onRetry,
  onLoadMore,
  onOpen,
}: {
  edges: NotificationEdge[];
  loading: boolean;
  failed: boolean;
  hasNextPage: boolean;
  loadingMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpen: (node: NotificationNode) => void;
}) {
  const t = useTranslations('notificationInbox');

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-3" aria-busy="true" data-testid={ids.loading}>
        <span className="sr-only">{t('loading')}</span>
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <div
        className="flex flex-col items-center gap-3 p-6 text-center"
        role="alert"
        data-testid={ids.error}
      >
        <p className="text-sm text-muted-foreground">{t('error')}</p>
        <Button variant="outline" size="sm" onClick={onRetry} data-testid={ids.retryBtn}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (edges.length === 0) {
    return (
      <Empty data-testid={ids.empty}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BellOff aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t('empty')}</EmptyTitle>
          <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div>
      <ul className="divide-y" data-testid={ids.list}>
        {edges.map(({ node }) => (
          <li key={node.id}>
            <NotificationRow node={node} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={onLoadMore}
            disabled={loadingMore}
            data-testid={ids.loadMoreBtn}
          >
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  node,
  onOpen,
}: {
  node: NotificationNode;
  onOpen: (node: NotificationNode) => void;
}) {
  const t = useTranslations('notificationInbox');
  const resolve = useI18nField();
  const { formatDistance } = useFormatDate();
  const unread = !node.readAt;

  return (
    <Button
      variant="ghost"
      className="h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-none px-3 py-3 text-start"
      onClick={() => onOpen(node)}
      data-testid={ids.item(node.id)}
    >
      <span
        aria-hidden
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          unread ? 'bg-primary' : 'bg-transparent',
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-start justify-between gap-2">
          <span className={cn('text-sm', unread ? 'font-semibold' : 'font-normal')}>
            {resolve(node.title)}
          </span>
          {unread && (
            <Badge variant="secondary" className="shrink-0">
              {t('unread')}
            </Badge>
          )}
        </span>
        <span className="text-sm font-normal text-muted-foreground">{resolve(node.body)}</span>
        <time className="text-xs font-normal text-muted-foreground" dateTime={node.createdAt}>
          {formatDistance(new Date(node.createdAt), new Date())}
        </time>
      </span>
    </Button>
  );
}
