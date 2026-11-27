import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  notifications,
  notificationsLive,
  withReseller,
  withTenant,
  withUser,
} from '@roviq/database';
import { type Column, count, desc, eq, isNull, lt, type SQL, sql } from 'drizzle-orm';
import type { NotificationViewer } from '../notification-viewer';
import {
  type ListNotificationsQuery,
  NotificationInboxRepository,
  type NotificationPage,
  type NotificationRecord,
} from './notification-inbox.repository';

interface OwnerColumns {
  scope: Column;
  tenantId: Column;
  resellerId: Column;
  recipientUserId: Column;
  recipientMembershipId: Column;
}

function allOf(...parts: SQL[]): SQL {
  return sql`(${sql.join(parts, sql` AND `)})`;
}

/**
 * The only definition of "the viewer's own notification". The database already limits
 * institute and reseller roles to their scope; this adds the person (and, in an
 * institute, the membership) and keeps the platform role to its own rows.
 */
function ownedBy(viewer: NotificationViewer, t: OwnerColumns): SQL {
  switch (viewer.scope) {
    case 'institute':
      return allOf(
        eq(t.scope, 'institute'),
        eq(t.tenantId, viewer.tenantId),
        eq(t.recipientUserId, viewer.userId),
        sql`(${isNull(t.recipientMembershipId)} OR ${eq(t.recipientMembershipId, viewer.membershipId)})`,
      );
    case 'reseller':
      return allOf(
        eq(t.scope, 'reseller'),
        eq(t.resellerId, viewer.resellerId),
        eq(t.recipientUserId, viewer.userId),
      );
    case 'platform':
      return allOf(eq(t.scope, 'platform'), eq(t.recipientUserId, viewer.userId));
  }
}

const liveFields = {
  id: notificationsLive.id,
  type: notificationsLive.type,
  title: notificationsLive.title,
  body: notificationsLive.body,
  data: notificationsLive.data,
  readAt: notificationsLive.readAt,
  archivedAt: notificationsLive.archivedAt,
  createdAt: notificationsLive.createdAt,
  flowId: notificationsLive.flowId,
};

const baseFields = {
  id: notifications.id,
  type: notifications.type,
  title: notifications.title,
  body: notifications.body,
  data: notifications.data,
  readAt: notifications.readAt,
  archivedAt: notifications.archivedAt,
  createdAt: notifications.createdAt,
  flowId: notifications.flowId,
};

@Injectable()
export class NotificationInboxDrizzleRepository extends NotificationInboxRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  /**
   * Each scope runs as its own database role with the caller's own token context. A platform
   * notification belongs to a person only, so it is read as that person.
   */
  private run<T>(viewer: NotificationViewer, fn: (tx: DrizzleDB) => Promise<T>): Promise<T> {
    switch (viewer.scope) {
      case 'institute':
        return withTenant(this.db, viewer.ctx, fn);
      case 'reseller':
        return withReseller(this.db, viewer.ctx, fn);
      case 'platform':
        return withUser(this.db, viewer.ctx, fn);
    }
  }

  async list(viewer: NotificationViewer, query: ListNotificationsQuery): Promise<NotificationPage> {
    return this.run(viewer, async (tx) => {
      const inbox = [ownedBy(viewer, notificationsLive), isNull(notificationsLive.archivedAt)];
      if (query.unreadOnly) inbox.push(isNull(notificationsLive.readAt));
      const page = query.afterId ? [...inbox, lt(notificationsLive.id, query.afterId)] : inbox;

      const [rows, [total]] = await Promise.all([
        tx
          .select(liveFields)
          .from(notificationsLive)
          .where(allOf(...page))
          .orderBy(desc(notificationsLive.id))
          .limit(query.first + 1),
        tx
          .select({ value: count() })
          .from(notificationsLive)
          .where(allOf(...inbox)),
      ]);
      return {
        rows: rows.slice(0, query.first),
        totalCount: total?.value ?? 0,
        hasNextPage: rows.length > query.first,
      };
    });
  }

  async countUnread(viewer: NotificationViewer): Promise<number> {
    return this.run(viewer, async (tx) => {
      const [row] = await tx
        .select({ value: count() })
        .from(notificationsLive)
        .where(
          allOf(
            ownedBy(viewer, notificationsLive),
            isNull(notificationsLive.archivedAt),
            isNull(notificationsLive.readAt),
          ),
        );
      return row?.value ?? 0;
    });
  }

  async findOne(viewer: NotificationViewer, id: string): Promise<NotificationRecord | null> {
    return this.run(viewer, (tx) => this.findIn(tx, viewer, id));
  }

  async markRead(viewer: NotificationViewer, id: string): Promise<NotificationRecord | null> {
    return this.run(viewer, async (tx) => {
      const [updated] = await tx
        .update(notifications)
        .set(this.touch(viewer, { readAt: sql`now()` }))
        .where(allOf(this.ownLiveRow(viewer, id), isNull(notifications.readAt)))
        .returning(baseFields);
      return updated ?? this.findIn(tx, viewer, id);
    });
  }

  async markAllRead(
    viewer: NotificationViewer,
  ): Promise<{ count: number; flowNotificationIds: string[] }> {
    return this.run(viewer, async (tx) => {
      const updated = await tx
        .update(notifications)
        .set(this.touch(viewer, { readAt: sql`now()` }))
        .where(
          allOf(
            ownedBy(viewer, notifications),
            isNull(notifications.deletedAt),
            isNull(notifications.archivedAt),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id, flowId: notifications.flowId });
      return {
        count: updated.length,
        flowNotificationIds: updated.filter((row) => row.flowId !== null).map((row) => row.id),
      };
    });
  }

  async archive(viewer: NotificationViewer, id: string): Promise<NotificationRecord | null> {
    return this.run(viewer, async (tx) => {
      const [updated] = await tx
        .update(notifications)
        .set(this.touch(viewer, { archivedAt: sql`now()` }))
        .where(allOf(this.ownLiveRow(viewer, id), isNull(notifications.archivedAt)))
        .returning(baseFields);
      return updated ?? this.findIn(tx, viewer, id);
    });
  }

  private async findIn(
    tx: DrizzleDB,
    viewer: NotificationViewer,
    id: string,
  ): Promise<NotificationRecord | null> {
    const [row] = await tx
      .select(liveFields)
      .from(notificationsLive)
      .where(allOf(eq(notificationsLive.id, id), ownedBy(viewer, notificationsLive)))
      .limit(1);
    return row ?? null;
  }

  private ownLiveRow(viewer: NotificationViewer, id: string): SQL {
    return allOf(
      eq(notifications.id, id),
      ownedBy(viewer, notifications),
      isNull(notifications.deletedAt),
    );
  }

  // Institute and reseller roles may update only these columns (rov-314 grants).
  private touch(
    viewer: NotificationViewer,
    change: { readAt: SQL } | { archivedAt: SQL },
  ): {
    readAt?: SQL;
    archivedAt?: SQL;
    updatedAt: SQL;
    updatedBy: string;
    version: SQL;
  } {
    return {
      ...change,
      updatedAt: sql`now()`,
      updatedBy: viewer.userId,
      version: sql`${notifications.version} + 1`,
    };
  }
}
