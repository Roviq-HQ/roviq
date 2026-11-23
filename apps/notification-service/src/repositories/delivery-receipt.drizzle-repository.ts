import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  notificationDeliveries,
  withAdmin,
} from '@roviq/database';
import { and, eq, sql } from 'drizzle-orm';
import { DeliveryReceiptRepository } from './delivery-receipt.repository';
import type { ProviderReceipt } from './types';

const ORIGIN = 'repository:delivery-receipt';

@Injectable()
export class DeliveryReceiptDrizzleRepository extends DeliveryReceiptRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async record(receipt: ProviderReceipt): Promise<'recorded' | 'duplicate' | 'unknown_message'> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const ofMessage = and(
        eq(notificationDeliveries.provider, receipt.provider),
        eq(notificationDeliveries.providerMessageId, receipt.providerMessageId),
      );
      // Two reports for one message must not both pass the "already recorded" check.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${receipt.provider}:${receipt.providerMessageId}`}, 0))`,
      );
      const [sent] = await tx
        .select()
        .from(notificationDeliveries)
        .where(and(ofMessage, eq(notificationDeliveries.status, 'SENT')))
        .limit(1);
      if (!sent) return 'unknown_message';

      const [same] = await tx
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(and(ofMessage, eq(notificationDeliveries.status, receipt.status)))
        .limit(1);
      if (same) return 'duplicate';

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
        status: receipt.status,
        errorCode: receipt.status === 'FAILED' ? (receipt.errorCode ?? 'SMS_UNDELIVERED') : null,
      });
      return 'recorded';
    });
  }
}
