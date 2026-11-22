import { Injectable } from '@nestjs/common';
import {
  type AuthUser,
  BusinessException,
  type DevicePlatform,
  ErrorCode,
} from '@roviq/common-types';
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
  ) {}

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
    return row;
  }

  async markAllRead(user: AuthUser): Promise<number> {
    const viewer = notificationViewerOf(user);
    assertOwnSession(user);
    return this.inbox.markAllRead(viewer);
  }

  async archive(user: AuthUser, id: string): Promise<NotificationRecord> {
    const viewer = notificationViewerOf(user);
    assertOwnSession(user);
    if (!isUUID(id)) throw notFound();
    const row = await this.inbox.archive(viewer, id);
    if (!row) throw notFound();
    return row;
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
