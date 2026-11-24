import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  notificationDeliveries,
  notifications,
  withAdmin,
} from '@roviq/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { FlowArrivalRepository } from './flow-arrival.repository';
import { arrivalOf } from './flow-arrival-of';
import type { FlowArrivalRecord, WrittenDelivery } from './types';

const ORIGIN = 'repository:flow-arrival';

@Injectable()
export class FlowArrivalDrizzleRepository extends FlowArrivalRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findInAppFlow(
    notificationId: string,
    recipientUserId: string,
  ): Promise<{ kind: 'found'; flowId: string | null } | { kind: 'not_found' }> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      // The recipient is part of the key: an event naming someone else's notification finds nothing.
      const [row] = await tx
        .select({ flowId: notifications.flowId })
        .from(notifications) // allow-base-read: archiving a row is itself a way of seeing it
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.recipientUserId, recipientUserId),
          ),
        )
        .limit(1);
      return row ? { kind: 'found', flowId: row.flowId } : { kind: 'not_found' };
    });
  }

  async acknowledgePush(
    notificationId: string,
    recipientUserId: string,
  ): Promise<
    | { kind: 'recorded'; arrival: FlowArrivalRecord | null; written: WrittenDelivery[] }
    | { kind: 'no_push' }
    | { kind: 'duplicate' }
  > {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const ofPush = and(
        eq(notificationDeliveries.notificationId, notificationId),
        eq(notificationDeliveries.recipientUserId, recipientUserId),
        eq(notificationDeliveries.channel, 'PUSH'),
      );
      // Two acknowledgements of one push must not both pass the "already recorded" check.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-ack:${notificationId}:${recipientUserId}`}, 0))`,
      );
      const [sent] = await tx
        .select()
        .from(notificationDeliveries)
        .where(and(ofPush, eq(notificationDeliveries.status, 'SENT')))
        .orderBy(desc(notificationDeliveries.createdAt), desc(notificationDeliveries.id))
        .limit(1);
      if (!sent) return { kind: 'no_push' };

      const [delivered] = await tx
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(and(ofPush, eq(notificationDeliveries.status, 'DELIVERED')))
        .limit(1);
      if (delivered) return { kind: 'duplicate' };

      await tx.insert(notificationDeliveries).values({
        scope: sent.scope,
        tenantId: sent.tenantId,
        resellerId: sent.resellerId,
        notificationId: sent.notificationId,
        recipientUserId: sent.recipientUserId,
        type: sent.type,
        channel: sent.channel,
        provider: sent.provider,
        attempt: sent.attempt,
        providerMessageId: sent.providerMessageId,
        flowId: sent.flowId,
        status: 'DELIVERED',
      });
      return {
        kind: 'recorded',
        arrival: arrivalOf(sent, 'DELIVERED'),
        written: [
          { channel: sent.channel, status: 'DELIVERED', provider: sent.provider, errorCode: null },
        ],
      };
    });
  }
}
