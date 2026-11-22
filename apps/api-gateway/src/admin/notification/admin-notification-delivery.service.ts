import { Injectable } from '@nestjs/common';
import type { PlatformContext } from '@roviq/common-types';
import { decodeIdCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import {
  AdminNotificationDeliveryRepository,
  type NotificationDeliveryRecord,
} from './admin-notification-delivery.repository';
import type { NotificationDeliveryFilterInput } from './models/notification-delivery.model';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface NotificationDeliveryConnectionResult {
  edges: { node: NotificationDeliveryRecord; cursor: string }[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  totalCount: number;
}

@Injectable()
export class AdminNotificationDeliveryService {
  constructor(private readonly deliveries: AdminNotificationDeliveryRepository) {}

  async list(
    ctx: PlatformContext,
    filter: NotificationDeliveryFilterInput,
    first: number | null,
    after: string | null,
  ): Promise<NotificationDeliveryConnectionResult> {
    const size = Math.min(Math.max(first ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const page = await this.deliveries.list(
      ctx,
      filter,
      size,
      after ? decodeIdCursor(after) : null,
    );
    const edges = page.rows.map((node) => ({ node, cursor: encodeCursor({ id: node.id }) }));
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
