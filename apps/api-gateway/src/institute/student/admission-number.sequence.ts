import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  type AdmissionNumberConfig,
  admissionSeriesName,
  type DrizzleDB,
  formatSequenceValue,
  instituteConfigsLive,
  LEGACY_ADMISSION_SEQUENCE,
  parseSequenceValue,
  pgErrorCode,
  resolveAdmissionPrefix,
  resolveAdmissionYear,
  sequenceLiteralPrefix,
  standardsLive,
  studentProfilesLive,
  tenantSequences,
} from '@roviq/database';
import { and, eq, like, sql } from 'drizzle-orm';

const DEFAULT_ADMISSION_NUMBER_CONFIG: AdmissionNumberConfig = {
  format: '{prefix}{value:04d}',
  year_format: 'YYYY',
  prefixes: {},
  no_prefix_from_class: 2,
};

/**
 * Numbers tried before an admission is refused. Each taken number moves the counter past the
 * highest taken number of the series, so a normal register needs two tries; the bound only stops
 * a series that cannot move (numbers that never parse back).
 */
export const MAX_ADMISSION_NUMBER_TRIES = 1000;

/** PostgreSQL's "numeric value out of range": the counter is at the bigint limit. */
const NUMERIC_OUT_OF_RANGE = '22003';

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
  options: { now?: Date; maxTries?: number } = {},
): Promise<string> {
  const series = await resolveSeries(tx, tenantId, standardId, options.now ?? new Date());
  await ensureSeries(tx, tenantId, series);

  const maxTries = options.maxTries ?? MAX_ADMISSION_NUMBER_TRIES;
  for (let tries = 0; tries < maxTries; tries++) {
    const number = formatSequenceValue(series.format, {
      ...series,
      value: await takeNextValue(tx, tenantId, series.sequenceName),
    });
    if (!(await isTaken(tx, tenantId, number))) return number;
    const highest = await highestTakenSerial(tx, tenantId, series);
    if (highest !== null) await raiseCounter(tx, tenantId, series.sequenceName, highest);
  }
  throw new BusinessException(
    ErrorCode.ADMISSION_NUMBER_SERIES_EXHAUSTED,
    `No free number in admission series ${series.sequenceName} after ${maxTries} tries`,
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
  await raiseCounter(tx, tenantId, series.sequenceName, serial);
}

async function takeNextValue(
  tx: DrizzleDB,
  tenantId: string,
  sequenceName: string,
): Promise<bigint> {
  try {
    const result = await tx.execute<{ next_val: string }>(
      sql`SELECT next_val FROM next_sequence_value(${tenantId}::uuid, ${sequenceName})`,
    );
    const row = result.rows[0];
    if (!row)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `Admission sequence ${sequenceName} not found`,
      );
    return BigInt(row.next_val);
  } catch (error) {
    if (pgErrorCode(error) === NUMERIC_OUT_OF_RANGE)
      throw new BusinessException(
        ErrorCode.ADMISSION_NUMBER_SERIES_EXHAUSTED,
        `Admission series ${sequenceName} is at its last value`,
      );
    throw error;
  }
}

async function isTaken(tx: DrizzleDB, tenantId: string, admissionNumber: string) {
  const [taken] = await tx
    .select({ id: studentProfilesLive.id })
    .from(studentProfilesLive)
    .where(
      and(
        eq(studentProfilesLive.tenantId, tenantId),
        eq(studentProfilesLive.admissionNumber, admissionNumber),
      ),
    )
    .limit(1);
  return taken !== undefined;
}

/** The highest serial among the live numbers this series would print, or null when none. */
async function highestTakenSerial(
  tx: DrizzleDB,
  tenantId: string,
  series: AdmissionSeries,
): Promise<bigint | null> {
  const literal = sequenceLiteralPrefix(series.format, series).replace(/[\\%_]/g, '\\$&');
  const rows = await tx
    .select({ admissionNumber: studentProfilesLive.admissionNumber })
    .from(studentProfilesLive)
    .where(
      and(
        eq(studentProfilesLive.tenantId, tenantId),
        like(studentProfilesLive.admissionNumber, `${literal}%`),
      ),
    );
  let highest: bigint | null = null;
  for (const { admissionNumber } of rows) {
    const serial = parseSequenceValue(series.format, series, admissionNumber);
    if (serial !== null && (highest === null || serial > highest)) highest = serial;
  }
  return highest;
}

async function raiseCounter(
  tx: DrizzleDB,
  tenantId: string,
  sequenceName: string,
  serial: bigint,
): Promise<void> {
  await tx
    .update(tenantSequences)
    .set({ currentValue: sql`GREATEST(${tenantSequences.currentValue}, ${serial}::bigint)` })
    .where(
      and(eq(tenantSequences.tenantId, tenantId), eq(tenantSequences.sequenceName, sequenceName)),
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
    .where(and(eq(standardsLive.id, standardId), eq(standardsLive.tenantId, tenantId)))
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
