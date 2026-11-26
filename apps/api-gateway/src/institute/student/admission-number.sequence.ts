import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  type AdmissionNumberConfig,
  admissionSeriesName,
  type DrizzleDB,
  formatSequenceValue,
  instituteConfigsLive,
  LEGACY_ADMISSION_SEQUENCE,
  parseSequenceValue,
  resolveAdmissionPrefix,
  resolveAdmissionYear,
  standardsLive,
  studentProfilesLive,
  tenantSequences,
} from '@roviq/database';
import { and, eq, sql } from 'drizzle-orm';

const DEFAULT_ADMISSION_NUMBER_CONFIG: AdmissionNumberConfig = {
  format: '{prefix}{value:04d}',
  year_format: 'YYYY',
  prefixes: {},
  no_prefix_from_class: 2,
};

/** Generated numbers already held by a live student are skipped, up to this many in a row. */
export const MAX_ADMISSION_NUMBER_SKIPS = 1000;

interface AdmissionSeries {
  format: string;
  prefix: string;
  year: string;
  sequenceName: string;
}

/**
 * Issue the next admission number for a student entering `standardId`, skipping numbers a live
 * student already holds (an imported register, or a number of another series' shape).
 *
 * Call inside the same `withTenant` transaction that inserts the student so a
 * failed insert rolls the counter back (no gaps) and the series row stays locked
 * until commit (no duplicates under concurrency).
 */
export async function nextAdmissionNumber(
  tx: DrizzleDB,
  tenantId: string,
  standardId: string,
  options: { now?: Date; maxSkips?: number } = {},
): Promise<string> {
  const series = await resolveSeries(tx, tenantId, standardId, options.now ?? new Date());
  await ensureSeries(tx, tenantId, series);

  const maxSkips = options.maxSkips ?? MAX_ADMISSION_NUMBER_SKIPS;
  for (let skipped = 0; skipped <= maxSkips; skipped++) {
    const result = await tx.execute<{ next_val: string }>(
      sql`SELECT next_val FROM next_sequence_value(${tenantId}::uuid, ${series.sequenceName})`,
    );
    const row = result.rows[0];
    if (!row)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `Admission sequence ${series.sequenceName} not found`,
      );

    const number = formatSequenceValue(series.format, { ...series, value: BigInt(row.next_val) });
    const [taken] = await tx
      .select({ id: studentProfilesLive.id })
      .from(studentProfilesLive)
      .where(
        and(
          eq(studentProfilesLive.tenantId, tenantId),
          eq(studentProfilesLive.admissionNumber, number),
        ),
      )
      .limit(1);
    if (!taken) return number;
  }
  throw new BusinessException(
    ErrorCode.ADMISSION_NUMBER_SERIES_EXHAUSTED,
    `The next ${maxSkips + 1} numbers of admission series ${series.sequenceName} are all taken`,
  );
}

/**
 * A number the institute supplied moves its series forward when the series would print exactly
 * that number, so later generated numbers continue after it. Another prefix, year or shape moves
 * nothing. Call inside the transaction that stores the student.
 */
export async function recordSuppliedAdmissionNumber(
  tx: DrizzleDB,
  tenantId: string,
  standardId: string,
  admissionNumber: string,
  now = new Date(),
): Promise<void> {
  const series = await resolveSeries(tx, tenantId, standardId, now);
  const serial = parseSequenceValue(series.format, series, admissionNumber);
  if (serial === null) return;

  await ensureSeries(tx, tenantId, series);
  await tx
    .update(tenantSequences)
    .set({ currentValue: sql`GREATEST(${tenantSequences.currentValue}, ${serial}::bigint)` })
    .where(
      and(
        eq(tenantSequences.tenantId, tenantId),
        eq(tenantSequences.sequenceName, series.sequenceName),
      ),
    );
}

async function resolveSeries(
  tx: DrizzleDB,
  tenantId: string,
  standardId: string,
  now: Date,
): Promise<AdmissionSeries> {
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
  return {
    format: config.format,
    prefix,
    year: resolveAdmissionYear(config, now),
    sequenceName: admissionSeriesName(prefix),
  };
}

/** A new series starts after the legacy shared counter, so its old numbers cannot repeat. */
async function ensureSeries(tx: DrizzleDB, tenantId: string, series: AdmissionSeries) {
  await tx
    .insert(tenantSequences)
    .values({
      tenantId,
      sequenceName: series.sequenceName,
      currentValue: sql`COALESCE((
        SELECT ${tenantSequences.currentValue} FROM ${tenantSequences}
        WHERE ${and(
          eq(tenantSequences.tenantId, tenantId),
          eq(tenantSequences.sequenceName, LEGACY_ADMISSION_SEQUENCE),
        )}
      ), 0)`,
      prefix: series.prefix || null,
      formatTemplate: series.format,
    })
    .onConflictDoNothing();
}
