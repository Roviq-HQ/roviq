import type { I18nContent } from '@roviq/database';
import type { NotificationViewer } from '../notification-viewer';

export interface NotificationRecord {
  id: string;
  type: string;
  title: I18nContent;
  body: I18nContent;
  data: Record<string, unknown> | null;
  readAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  rows: NotificationRecord[];
  totalCount: number;
  hasNextPage: boolean;
}

export interface ListNotificationsQuery {
  first: number;
  /** Id of the last row of the previous page; rows older than it come next. */
  afterId: string | null;
  unreadOnly: boolean;
}

/** Every method is limited to the viewer's own notifications; none takes a user id. */
export abstract class NotificationInboxRepository {
  abstract list(
    viewer: NotificationViewer,
    query: ListNotificationsQuery,
  ): Promise<NotificationPage>;
  abstract countUnread(viewer: NotificationViewer): Promise<number>;
  abstract findOne(viewer: NotificationViewer, id: string): Promise<NotificationRecord | null>;
  abstract markRead(viewer: NotificationViewer, id: string): Promise<NotificationRecord | null>;
  abstract markAllRead(viewer: NotificationViewer): Promise<number>;
  abstract archive(viewer: NotificationViewer, id: string): Promise<NotificationRecord | null>;
}
