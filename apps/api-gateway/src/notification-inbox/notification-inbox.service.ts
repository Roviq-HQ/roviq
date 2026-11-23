import { Injectable } from '@nestjs/common';
import {
  type AuthUser,
  BusinessException,
  type DevicePlatform,
  ErrorCode,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { isUUID } from 'class-validator';
import { decodeIdCursor, encodeCursor } from '../common/pagination/relay-pagination.model';
import {
  assertOwnSession,
  assertValidDeviceToken,
  notificationViewerOf,
} from './notification-viewer';
import { DeviceTokenRepository } from './repositories/device-token.repository';
import {
  NotificationInboxRepository,
  type NotificationRecord,
} from './repositories/notification-inbox.repository';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface NotificationConnectionResult {
  edges: { node: NotificationRecord; cursor: string }[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  totalCount: number;
}

// Same answer for a missing id and someone else's, so ids cannot be probed.
const notFound = () =>
  new BusinessException(ErrorCode.NOTIFICATION_NOT_FOUND, 'Notification not found');

@Injectable()
export class NotificationInboxService {
  constructor(
    private readonly inbox: NotificationInboxRepository,
    private readonly devices: DeviceTokenRepository,
    private readonly eventBus: EventBusService,
  ) {}

  /** A read or an archive ends the notification's delivery flow: no paid message follows. */
  private seen(user: AuthUser, notificationId: string): void {
    this.eventBus.emit(EVENT_PATTERNS.NOTIFICATION.INAPP_SEEN, {
      notificationId,
      recipientUserId: user.userId,
    });
  }

  async list(
    user: AuthUser,
    args: { first?: number | null; after?: string | null; unreadOnly?: boolean | null },
  ): Promise<NotificationConnectionResult> {
    const viewer = notificationViewerOf(user);
    const first = Math.min(Math.max(args.first ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const page = await this.inbox.list(viewer, {
      first,
      afterId: args.after ? decodeIdCursor(args.after) : null,
      unreadOnly: args.unreadOnly ?? false,
    });
    const edges = page.rows.map((node) => ({ node, cursor: encodeCursor({ id: node.id }) }));
    return {
      edges,
      pageInfo: {
        hasNextPage: page.hasNextPage,
        hasPreviousPage: Boolean(args.after),
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges[edges.length - 1]?.cursor ?? null,
      },
      totalCount: page.totalCount,
    };
  }

  countUnread(user: AuthUser): Promise<number> {
    return this.inbox.countUnread(notificationViewerOf(user));
  }

  /** For the live feed: null when the row is not the caller's, so the event is dropped. */
  findOwn(user: AuthUser, id: string): Promise<NotificationRecord | null> {
    if (!isUUID(id)) return Promise.resolve(null);
    return this.inbox.findOne(notificationViewerOf(user), id);
  }

  async markRead(user: AuthUser, id: string): Promise<NotificationRecord> {
    const viewer = notificationViewerOf(user);
    assertOwnSession(user);
    if (!isUUID(id)) throw notFound();
    const row = await this.inbox.markRead(viewer, id);
    if (!row) throw notFound();
    if (row.flowId !== null) this.seen(user, row.id);
    return row;
  }

  async markAllRead(user: AuthUser): Promise<number> {
    const viewer = notificationViewerOf(user);
    assertOwnSession(user);
    const { count, flowNotificationIds } = await this.inbox.markAllRead(viewer);
    for (const id of flowNotificationIds) this.seen(user, id);
    return count;
  }

  async archive(user: AuthUser, id: string): Promise<NotificationRecord> {
    const viewer = notificationViewerOf(user);
    assertOwnSession(user);
    if (!isUUID(id)) throw notFound();
    const row = await this.inbox.archive(viewer, id);
    if (!row) throw notFound();
    if (row.flowId !== null) this.seen(user, row.id);
    return row;
  }

  /**
   * The recipient's device says it showed the push. Only a pointer is published: the
   * notification service finds the push it sent for this row and records the delivery.
   */
  async acknowledgeDelivery(user: AuthUser, id: string): Promise<boolean> {
    const viewer = notificationViewerOf(user);
    assertOwnSession(user);
    if (!isUUID(id)) throw notFound();
    const row = await this.inbox.findOne(viewer, id);
    if (!row) throw notFound();
    this.eventBus.emit(EVENT_PATTERNS.NOTIFICATION.PUSH_ACKNOWLEDGED, {
      notificationId: row.id,
      recipientUserId: user.userId,
    });
    return true;
  }

  async registerDeviceToken(
    user: AuthUser,
    token: string,
    platform: DevicePlatform,
  ): Promise<boolean> {
    assertOwnSession(user);
    assertValidDeviceToken(token);
    await this.devices.register(user.userId, token, platform);
    return true;
  }

  async unregisterDeviceToken(user: AuthUser, token: string): Promise<boolean> {
    assertOwnSession(user);
    assertValidDeviceToken(token);
    await this.devices.unregister(user.userId, token);
    return true;
  }
}
