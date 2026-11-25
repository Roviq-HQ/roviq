/**
 * ROV-276: after the e2e seed, the next admission number in every class of every seeded
 * institute is free. Seeded students carry numbers from the runtime series and each
 * series counter starts past them. Every issue is rolled back so the shared database
 * keeps its counters.
 */
import {
  type DrizzleDB,
  mkAdminCtx,
  standardsLive,
  studentProfiles,
  withAdmin,
} from '@roviq/database';
import { SEED_ADMISSIONS, SEED_IDS, seedE2e } from '@roviq/database/seed';
import { createIntegrationApp, type IntegrationAppResult } from '@roviq/testing/integration';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { nextAdmissionNumber } from '../admission-number.sequence';

class Rollback extends Error {}

async function issueInEveryClass(db: DrizzleDB, tenantId: string): Promise<string[]> {
  let issued: string[] = [];
  try {
    await withAdmin(db, mkAdminCtx('test:seeded-admission-series'), async (tx) => {
      const classes = await tx
        .select({ id: standardsLive.id })
        .from(standardsLive)
        .where(eq(standardsLive.tenantId, tenantId))
        .orderBy(standardsLive.numericOrder);
      expect(classes.length).toBeGreaterThan(0);
      const numbers: string[] = [];
      for (const c of classes) numbers.push(await nextAdmissionNumber(tx, tenantId, c.id));
      const taken = await tx
        .select({ n: studentProfiles.admissionNumber })
        .from(studentProfiles)
        .where(
          and(
            eq(studentProfiles.tenantId, tenantId),
            inArray(studentProfiles.admissionNumber, numbers),
          ),
        );
      expect(taken).toEqual([]);
      issued = numbers;
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return issued;
}

describe('Seeded admission numbers and the generated series (ROV-276)', () => {
  let result: IntegrationAppResult;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    await seedE2e(result.db);
  }, 120_000);

  afterAll(async () => {
    await result?.close();
  });

  it.each([
    ['Institute 1', SEED_IDS.INSTITUTE_1],
    ['Institute 2', SEED_IDS.INSTITUTE_2],
  ])('issues a free, distinct number in every class of %s', async (_label, tenantId) => {
    const issued = await issueInEveryClass(result.db, tenantId);
    expect(new Set(issued).size).toBe(issued.length);
  });

  it('starts the Nursery and Class 5 series of Institute 1 past the seeded students', async () => {
    const issued = await issueInEveryClass(result.db, SEED_IDS.INSTITUTE_1);
    const serialOf = (n: string) => Number(/(\d+)$/.exec(n)?.[1]);
    const nursery = issued.find((n) => n.startsWith(SEED_ADMISSIONS.STUDENT_1.prefix));
    const unprefixed = issued.filter((n) => /^\d{4}\//.test(n));
    expect(nursery && serialOf(nursery)).toBeGreaterThan(SEED_ADMISSIONS.STUDENT_7.value);
    expect(Math.min(...unprefixed.map(serialOf))).toBeGreaterThan(SEED_ADMISSIONS.STUDENT_5.value);
  });
});
