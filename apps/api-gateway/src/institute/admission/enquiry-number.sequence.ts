import { BusinessException, ErrorCode } from '@roviq/common-types';
import { type DrizzleDB, tenantSequences } from '@roviq/database';
import { sql } from 'drizzle-orm';

const SEQUENCE_NAME = 'enq_no';

/**
 * Take the next `ENQ-000123` number. Call inside the transaction that inserts the enquiry, so a
 * failed insert rolls the counter back and the series has no gaps.
 */
export async function nextEnquiryNumber(tx: DrizzleDB, tenantId: string): Promise<string> {
  await tx
    .insert(tenantSequences)
    .values({
      tenantId,
      sequenceName: SEQUENCE_NAME,
      currentValue: 0n,
      formatTemplate: 'ENQ-{value:06d}',
    })
    .onConflictDoNothing();

  const result = await tx.execute<{ formatted: string }>(
    sql`SELECT formatted FROM next_sequence_value(${tenantId}::uuid, ${SEQUENCE_NAME})`,
  );
  const row = result.rows[0];
  if (!row) {
    throw new BusinessException(ErrorCode.NOT_FOUND, `Enquiry sequence ${SEQUENCE_NAME} not found`);
  }
  return row.formatted;
}
