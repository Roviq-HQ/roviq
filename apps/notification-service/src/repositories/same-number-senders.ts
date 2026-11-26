import { type DrizzleDB, messagingSenders } from '@roviq/database';
import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

/**
 * Ids of every sender row, removed ones included, that stands for the same provider number
 * as `senderId`. A stop request belongs to the number a person wrote to: it must keep
 * counting after that number's sender row is deleted and registered again.
 */
export function sameNumberSenderIds(tx: DrizzleDB, senderId: string) {
  const current = alias(messagingSenders, 'current_sender'); // allow-base-read: a removed sender's opt-outs still bind its number
  const sameNumber = alias(messagingSenders, 'same_number_sender'); // allow-base-read: see above
  return tx
    .select({ id: sameNumber.id })
    .from(current) // allow-base-read: a removed sender's opt-outs still bind its number
    .innerJoin(
      sameNumber, // allow-base-read: see above
      and(
        eq(sameNumber.provider, current.provider),
        eq(sameNumber.providerNumberId, current.providerNumberId),
      ),
    )
    .where(eq(current.id, senderId));
}
