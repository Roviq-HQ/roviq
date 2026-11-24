import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CRITICAL_NOTIFICATION_TYPES,
  type InstituteContext,
  NOTIFICATION_MODULE_OF,
  NOTIFICATION_TYPE_VALUES,
  type NotificationModule,
  type NotificationTypeKey,
} from '@roviq/common-types';
import { decodeIdCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import type {
  NotificationDeliveryLogEntry,
  NotificationDeliveryLogFilterInput,
} from './models/notification-delivery-log.model';
import { NotificationDeliveryRepository } from './repositories/notification-delivery.repository';
import type { DeliveryLogEntryRecord, DeliveryLogQuery } from './repositories/types';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface NotificationDeliveryLogConnectionResult {
  edges: { node: NotificationDeliveryLogEntry; cursor: string }[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  totalCount: number;
}

@Injectable()
export class NotificationDeliveryService {
  constructor(private readonly deliveries: NotificationDeliveryRepository) {}

  async log(
    ctx: InstituteContext,
    filter: NotificationDeliveryLogFilterInput,
    first: number | null,
    after: string | null,
  ): Promise<NotificationDeliveryLogConnectionResult> {
    const size = Math.min(Math.max(first ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const page = await this.deliveries.listLog(
      ctx,
      toQuery(filter),
      size,
      after ? decodeIdCursor(after) : null,
    );
    const edges = page.entries.map((entry) => ({
      node: toEntry(entry),
      cursor: encodeCursor({ id: entry.lastRowId }),
    }));
    return {
      edges,
      pageInfo: {
        hasNextPage: page.hasNextPage,
        hasPreviousPage: Boolean(after),
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges[edges.length - 1]?.cursor ?? null,
      },
      totalCount: page.totalCount,
    };
  }
}

/**
 * Module, type and criticality narrow the same column, so they become one list of types. With
 * no filter it is every known type: a row of a type that no longer exists is not shown.
 */
export function typesFor(filter: {
  module?: NotificationModule;
  type?: NotificationTypeKey;
  criticalOnly?: boolean;
}): readonly NotificationTypeKey[] {
  return NOTIFICATION_TYPE_VALUES.filter(
    (type) =>
      (!filter.module || NOTIFICATION_MODULE_OF[type] === filter.module) &&
      (!filter.type || type === filter.type) &&
      (!filter.criticalOnly || CRITICAL_NOTIFICATION_TYPES.includes(type)),
  );
}

function toQuery(filter: NotificationDeliveryLogFilterInput): DeliveryLogQuery {
  return {
    types: typesFor(filter),
    channel: filter.channel ?? null,
    state: filter.state ?? null,
    studentId: filter.studentId ?? null,
    sessionId: filter.sessionId ?? null,
    recipientUserId: filter.recipientUserId ?? null,
    from: filter.from ?? null,
    to: filter.to ?? null,
    notDeliveredOnly: filter.notDeliveredOnly ?? false,
  };
}

function toEntry(entry: DeliveryLogEntryRecord): NotificationDeliveryLogEntry {
  const { lastRowId: _row, entryKey, type, ...rest } = entry;
  // Hashed: the key can be a provider's message id or a flow id, neither of which is returned.
  const id = createHash('sha256')
    .update(`${entryKey}|${entry.recipientUserId}`)
    .digest('base64url');
  return {
    ...rest,
    id,
    type,
    module: NOTIFICATION_MODULE_OF[type],
    critical: CRITICAL_NOTIFICATION_TYPES.includes(type),
  };
}
