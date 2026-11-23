import { jetstream } from '@nats-io/jetstream';
import { type NatsConnection, headers as natsHeaders } from '@nats-io/nats-core';
import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessException,
  DLQ_STATE_MACHINE,
  type DlqStatus,
  ErrorCode,
} from '@roviq/common-types';
import { decodeCursor, encodeCursor } from '../common/pagination/relay-pagination.model';
import { DLQ_NATS_CONNECTION } from './dlq-nats.provider';
import type { DlqMessageFilterInput } from './models/dlq-message.model';
import { DlqRepository } from './repositories/dlq.repository';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class DlqService {
  constructor(
    private readonly repo: DlqRepository,
    @Inject(DLQ_NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  /**
   * Build the JetStreamServer replay envelope: the original subject, the
   * `{pattern,data}` body the server expects, and the restored correlation/
   * tenant headers. Pure so the replay contract can be asserted without NATS.
   */
  static buildReplayPublish(row: {
    originalSubject: string;
    payload: unknown;
    correlationId: string;
    tenantId: string | null;
  }): { subject: string; data: string; headers: Record<string, string> } {
    return {
      subject: row.originalSubject,
      data: JSON.stringify({ pattern: row.originalSubject, data: row.payload }),
      headers: {
        'correlation-id': row.correlationId,
        'tenant-id': row.tenantId ?? '',
      },
    };
  }

  /** List dead-lettered messages, newest-first, keyset-paginated on id DESC. */
  async list(filter: DlqMessageFilterInput = {}) {
    const limit = Math.min(filter.first ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    let beforeId: string | undefined;
    if (filter.after) {
      const cursor = decodeCursor(filter.after);
      if (typeof cursor.id === 'string') beforeId = cursor.id;
    }

    const { records, totalCount } = await this.repo.list({
      originStream: filter.originStream,
      status: filter.status,
      tenantId: filter.tenantId,
      beforeId,
      limit: limit + 1,
    });

    const hasNextPage = records.length > limit;
    const nodes = hasNextPage ? records.slice(0, limit) : records;
    const edges = nodes.map((node) => ({ node, cursor: encodeCursor({ id: node.id }) }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        // Forward-only keyset pagination: a previous page exists iff we paged past the first.
        hasPreviousPage: Boolean(filter.after),
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges[edges.length - 1]?.cursor ?? null,
      },
      totalCount,
    };
  }

  /** Messages still awaiting an admin decision — the monitoring page's DLQ banner. */
  async countPending(): Promise<number> {
    return this.repo.countPending();
  }

  /** Re-publish a message to its original subject (pending|replayed → replayed). */
  async replay(id: string, replayedBy: string) {
    const result = await this.repo.replay(id, replayedBy, async (row) => {
      const status: DlqStatus = row.status as DlqStatus;
      DLQ_STATE_MACHINE.assertTransition(status, 'replayed');

      const pub = DlqService.buildReplayPublish(row);
      const hdrs = natsHeaders();
      for (const [key, value] of Object.entries(pub.headers)) {
        if (value) hdrs.set(key, value);
      }
      await jetstream(this.nc).publish(pub.subject, pub.data, { headers: hdrs });
    });
    if (result.kind === 'not_found')
      throw new BusinessException(ErrorCode.DLQ_MESSAGE_NOT_FOUND, `DLQ message ${id} not found`);
    return result.row;
  }

  /** Discard a message without replaying it (pending|replayed → discarded). */
  async discard(id: string) {
    const result = await this.repo.discard(id, (row) => {
      const status: DlqStatus = row.status as DlqStatus;
      DLQ_STATE_MACHINE.assertTransition(status, 'discarded');
    });
    if (result.kind === 'not_found')
      throw new BusinessException(ErrorCode.DLQ_MESSAGE_NOT_FOUND, `DLQ message ${id} not found`);
    return result.row;
  }
}
