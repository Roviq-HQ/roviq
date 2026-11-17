import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  type AdmissionNumberConfig,
  type DrizzleDB,
  instituteConfigsLive,
  standardsLive,
  tenantSequences,
} from '@roviq/database';
import { and, eq, sql } from 'drizzle-orm';
import {
  admissionSeriesName,
  formatSequenceValue,
  LEGACY_ADMISSION_SEQUENCE,
  resolveAdmissionPrefix,
  resolveAdmissionYear,
} from './admission-number';

const DEFAULT_ADMISSION_NUMBER_CONFIG: AdmissionNumberConfig = {
  format: '{prefix}{value:04d}',
  year_format: 'YYYY',
  prefixes: {},
  no_prefix_from_class: 2,
};

/**
 * Issue the next admission number for a student entering `standardId`.
 *
 * Call inside the same `withTenant` transaction that inserts the student so a
 * failed insert rolls the counter back (no gaps) and the series row stays locked
 * until commit (no duplicates under concurrency).
 */
export async function nextAdmissionNumber(
  tx: DrizzleDB,
  tenantId: string,
  standardId: string,
  now = new Date(),
): Promise<string> {
  const [configRow] = await tx
    .select({ config: instituteConfigsLive.admissionNumberConfig })
    .from(instituteConfigsLive)
    .where(eq(instituteConfigsLive.tenantId, tenantId))
    .limit(1);
  const config = configRow?.config ?? DEFAULT_ADMISSION_NUMBER_CONFIG;

  const [standard] = await tx
    .select({ numericOrder: standardsLive.numericOrder })
    .from(standardsLive)
    .where(eq(standardsLive.id, standardId))
    .limit(1);
  if (!standard)
    throw new BusinessException(ErrorCode.STANDARD_NOT_FOUND, `Standard ${standardId} not found`);

  const prefix = resolveAdmissionPrefix(config, standard.numericOrder);
  const sequenceName = admissionSeriesName(prefix);

  await tx
    .insert(tenantSequences)
    .values({
      tenantId,
      sequenceName,
      currentValue: sql`COALESCE((
        SELECT ${tenantSequences.currentValue} FROM ${tenantSequences}
        WHERE ${and(
          eq(tenantSequences.tenantId, tenantId),
          eq(tenantSequences.sequenceName, LEGACY_ADMISSION_SEQUENCE),
        )}
      ), 0)`,
      prefix: prefix || null,
      formatTemplate: config.format,
    })
    .onConflictDoNothing();

  const result = await tx.execute<{ next_val: string }>(
    sql`SELECT next_val FROM next_sequence_value(${tenantId}::uuid, ${sequenceName})`,
  );
  const row = result.rows[0];
  if (!row)
    throw new BusinessException(
      ErrorCode.NOT_FOUND,
      `Admission sequence ${sequenceName} not found`,
    );

  return formatSequenceValue(config.format, {
    prefix,
    year: resolveAdmissionYear(config, now),
    value: BigInt(row.next_val),
  });
}
