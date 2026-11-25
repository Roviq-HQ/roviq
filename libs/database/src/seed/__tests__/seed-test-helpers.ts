import { and, eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { expect } from 'vitest';
import { TEST_SUPERUSER_URL } from '../../__tests__/test-helpers';
import { createDrizzleDb, type DrizzleDB } from '../../providers';
import {
  instituteConfigs,
  standards,
  studentAcademics,
  studentProfiles,
  tenantSequences,
} from '../../schema';
import {
  admissionSeriesName,
  formatSequenceValue,
  resolveAdmissionPrefix,
  resolveAdmissionYear,
} from '../../sequences/admission-number';
import { SEED_ADMISSIONS } from '../fixtures';
import { SEED_IDS } from '../ids';

export function makeSeedTestDb() {
  const pool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
  const db = createDrizzleDb(pool);
  return { pool, db };
}

/**
 * Hook timeout for a seed run. Every seed upserts the Roviq Direct reseller, so it waits while
 * the ROV-91 backfill test holds `LOCK TABLE resellers`; on a loaded machine the full demo seed
 * plus that wait goes past the 10 s default.
 */
export const SEED_HOOK_TIMEOUT_MS = 60_000;

const SEEDED_ADMISSION_PROFILE_IDS = {
  STUDENT_1: SEED_IDS.STUDENT_PROFILE_1,
  STUDENT_2: SEED_IDS.STUDENT_PROFILE_2,
  STUDENT_3: SEED_IDS.STUDENT_PROFILE_3,
  STUDENT_4: SEED_IDS.STUDENT_PROFILE_4,
  STUDENT_5: SEED_IDS.STUDENT_PROFILE_5,
  STUDENT_6: SEED_IDS.STUDENT_PROFILE_6,
  STUDENT_7: SEED_IDS.STUDENT_PROFILE_7,
} as const satisfies Record<keyof typeof SEED_ADMISSIONS, string>;

/**
 * Every seeded student whose profile exists carries the number the runtime series would
 * have issued for its class and admission date, and that series' counter is at least its
 * value, so the next generated number cannot repeat it (ROV-276).
 */
export async function expectSeededAdmissionsMatchSeries(
  db: DrizzleDB,
  keys: readonly (keyof typeof SEED_ADMISSIONS)[],
): Promise<void> {
  const ids = keys.map((k) => SEEDED_ADMISSION_PROFILE_IDS[k]);
  const rows = await db
    .select({
      id: studentProfiles.id,
      tenantId: studentProfiles.tenantId,
      admissionNumber: studentProfiles.admissionNumber,
      admissionDate: studentProfiles.admissionDate,
      numericOrder: standards.numericOrder,
      config: instituteConfigs.admissionNumberConfig,
    })
    .from(studentProfiles)
    .innerJoin(studentAcademics, eq(studentAcademics.studentProfileId, studentProfiles.id))
    .innerJoin(standards, eq(standards.id, studentAcademics.standardId))
    .innerJoin(instituteConfigs, eq(instituteConfigs.tenantId, studentProfiles.tenantId))
    .where(inArray(studentProfiles.id, ids));
  expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());

  const highest = new Map<string, bigint>();
  for (const row of rows) {
    const config = row.config;
    if (!config) throw new Error(`Institute ${row.tenantId} has no admission number config`);
    const value = BigInt(/(\d+)$/.exec(row.admissionNumber)?.[1] ?? 'NaN');
    const [y, m, d] = String(row.admissionDate).split('-').map(Number);
    const prefix = resolveAdmissionPrefix(config, row.numericOrder);
    expect(row.admissionNumber).toBe(
      formatSequenceValue(config.format, {
        prefix,
        year: resolveAdmissionYear(config, new Date(y, m - 1, d)),
        value,
      }),
    );
    const key = `${row.tenantId}|${admissionSeriesName(prefix)}`;
    if (value > (highest.get(key) ?? 0n)) highest.set(key, value);
  }

  for (const k of keys) {
    const row = rows.find((r) => r.id === SEEDED_ADMISSION_PROFILE_IDS[k]);
    expect(row?.admissionNumber).toBe(SEED_ADMISSIONS[k].admissionNumber);
  }

  for (const [key, value] of highest) {
    const [tenantId, sequenceName] = key.split('|');
    const [counter] = await db
      .select({ currentValue: tenantSequences.currentValue })
      .from(tenantSequences)
      .where(
        and(eq(tenantSequences.tenantId, tenantId), eq(tenantSequences.sequenceName, sequenceName)),
      );
    expect(counter?.currentValue ?? 0n).toBeGreaterThanOrEqual(value);
  }
}
