import { BusinessException, ErrorCode } from '@roviq/common-types';
import { academicYearsLive, type DrizzleDB, tenantSequences } from '@roviq/database';
import { eq, sql } from 'drizzle-orm';
import { formatSequenceValue } from '../student/admission-number';

/** Counter resets per academic year, so the year label must be part of the serial to stay unique. */
export function formatTcSerial(academicYearLabel: string, value: bigint): string {
  return formatSequenceValue(`TC/${academicYearLabel}/{value:04d}`, {
    prefix: '',
    year: '',
    value,
  });
}

/** Issue the next TC serial (e.g. `TC/2025-26/0001`). Call inside the issuing transaction. */
export async function nextTcSerialNumber(
  tx: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<string> {
  const [year] = await tx
    .select({ label: academicYearsLive.label })
    .from(academicYearsLive)
    .where(eq(academicYearsLive.id, academicYearId))
    .limit(1);
  if (!year)
    throw new BusinessException(
      ErrorCode.ACADEMIC_YEAR_NOT_FOUND,
      `Academic year ${academicYearId} not found`,
    );

  const sequenceName = `tc_no:${academicYearId}`;
  await tx
    .insert(tenantSequences)
    .values({
      tenantId,
      sequenceName,
      currentValue: 0n,
      formatTemplate: `TC/${year.label}/{value:04d}`,
    })
    .onConflictDoNothing();

  const result = await tx.execute<{ next_val: string }>(
    sql`SELECT next_val FROM next_sequence_value(${tenantId}::uuid, ${sequenceName})`,
  );
  const row = result.rows[0];
  if (!row)
    throw new BusinessException(ErrorCode.NOT_FOUND, `TC sequence ${sequenceName} not found`);

  return formatTcSerial(year.label, BigInt(row.next_val));
}
