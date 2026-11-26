/**
 * Calls every field of `Query` as several callers and looks, in each whole response, for any
 * id that belongs to an institute the caller has nothing to do with.
 *
 * The queries are read from the running gateway by introspection, so a new query is covered
 * the day it is added. Each is called twice: with the caller's own ids, and with another
 * institute's ids in every id argument. The tables are in `two-institute-queries.ts`.
 *
 * This does not replace the foreign-id specs (`foreign-id-coverage.ts`): they prove what a
 * mutation refuses and that nothing is written. This spec reads only.
 */
import { writeFileSync } from 'node:fs';
import { InstituteType } from '@roviq/common-types';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import {
  loginAsGuardian,
  loginAsInstituteAdmin,
  loginAsPlatformAdmin,
  loginAsReseller,
  loginAsStudent,
  loginAsTeacher,
} from './helpers/auth';
import { loginAsFreshInstituteAdmin } from './helpers/fresh-institute';
import { gql } from './helpers/gql-client';
import {
  collectInstituteIds,
  collectResellerIds,
  type ForeignIdHit,
  findForeignIds,
  pickInstituteIds,
  SUPERUSER_URL,
} from './helpers/institute-rows';
import {
  buildCall,
  errorFieldPath,
  type IdSource,
  loadSchema,
  type QueryField,
  queryFields,
  UnfillableArgumentError,
} from './helpers/schema-queries';
import {
  createSecondReseller,
  removeSecondReseller,
  type SecondReseller,
} from './helpers/second-reseller';
import {
  ARGUMENT_TABLES,
  EXPECTED_TO_FAIL,
  NOT_CALLED,
  WITHOUT_DATA,
} from './two-institute-queries';

/** How many levels of object fields each query selects. */
const DEPTH = 3;

/** How often a query is asked again without the nested fields that failed. */
const MAX_ROUNDS = 6;

/** Answers that mean the call was built wrongly, so it proved nothing. */
const BROKEN_CALL_CODES = new Set([
  'GRAPHQL_VALIDATION_FAILED',
  'BAD_USER_INPUT',
  'INTERNAL_ERROR',
]);

interface Caller {
  name: string;
  token: string;
  /** One id of each kind from the caller's own institute. */
  own: Record<string, string>;
  /** One id of each kind from an institute that is not the caller's. */
  other: Record<string, string>;
  /** Every id that must never reach this caller. */
  foreign: Map<string, string>;
}

interface Outcome {
  operation: string;
  caller: string;
  source: IdSource;
  /** `data` when the call returned without errors, else the first error code. */
  result: string;
  kindsWithoutRow: string[];
  /** Nested fields left out because the caller may not read them. */
  skippedFields: string[];
  hits: ForeignIdHit[];
}

const fields = queryFields(await loadSchema());
const outcomes: Outcome[] = [];

/** Calls one query as one caller, records the outcome and returns what is wrong with it. */
async function ask(field: QueryField, caller: Caller, source: IdSource): Promise<string[]> {
  const ids = source === 'own' ? caller.own : caller.other;
  const hits: ForeignIdHit[] = [];
  const skip = new Set<string>();
  let call = buildCall(field, ARGUMENT_TABLES, ids, source, DEPTH);
  let res = await gql(call.document, call.variables, caller.token);

  // A nested field the caller may not read fails the whole answer. Leave such fields out
  // and ask again, so the rest is still scanned.
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const nested = (res.errors ?? []).map(errorFieldPath).filter((p) => p.includes('.'));
    if (nested.length === 0 || nested.every((p) => skip.has(p))) break;
    for (const p of nested) skip.add(p);
    hits.push(...findForeignIds(res, caller.foreign, call.sentIds));
    call = buildCall(field, ARGUMENT_TABLES, ids, source, DEPTH, skip);
    res = await gql(call.document, call.variables, caller.token);
  }
  hits.push(...findForeignIds(res, caller.foreign, call.sentIds));

  const result = res.errors?.length ? String(res.errors[0]?.extensions?.code ?? 'NO_CODE') : 'data';
  outcomes.push({
    operation: field.name,
    caller: caller.name,
    source,
    result,
    kindsWithoutRow: call.kindsWithoutRow,
    skippedFields: [...skip],
    hits,
  });

  const where = `${caller.name}, ${source} ids`;
  const problems = hits.map((hit) => `${where}: the response holds ${hit.source} ${hit.id}`);
  if (BROKEN_CALL_CODES.has(result)) {
    problems.push(
      `${where}: the generated call was refused as invalid (${result}: ${res.errors?.[0]?.message})`,
    );
  }
  return problems;
}

describe('Two-institute response scan', () => {
  let pool: pg.Pool;
  let reseller: SecondReseller | undefined;
  const callers: Caller[] = [];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: SUPERUSER_URL });

    const freshToken = await loginAsFreshInstituteAdmin(InstituteType.SCHOOL);
    const mine = await gql<{ myInstitute: { id: string } }>(
      '{ myInstitute { id } }',
      undefined,
      freshToken,
    );
    const freshId = mine.data?.myInstitute.id;
    if (!freshId) throw new Error(`myInstitute failed: ${JSON.stringify(mine.errors)}`);

    const seeded = [SEED.INSTITUTE_1.id, SEED.INSTITUTE_2.id];
    const first = await pickInstituteIds(pool, SEED.INSTITUTE_1.id);
    const second = await pickInstituteIds(pool, SEED.INSTITUTE_2.id);
    const fresh = await pickInstituteIds(pool, freshId);
    const seededRows = await collectInstituteIds(pool, seeded);
    const freshRows = await collectInstituteIds(pool, [freshId]);
    const notFirst = await collectInstituteIds(pool, [SEED.INSTITUTE_2.id, freshId]);
    const all = await collectInstituteIds(pool, [...seeded, freshId]);

    // The seeded admin belongs to both seeded institutes, so only the fresh one is foreign.
    callers.push(
      {
        name: 'admin of a new institute',
        token: freshToken,
        own: fresh,
        other: first,
        foreign: seededRows,
      },
      {
        name: 'admin of the first institute',
        token: (await loginAsInstituteAdmin(0)).accessToken,
        own: first,
        other: fresh,
        foreign: freshRows,
      },
      {
        name: 'teacher of the first institute',
        token: (await loginAsTeacher()).accessToken,
        own: first,
        other: { ...fresh, ...second },
        foreign: notFirst,
      },
      {
        name: 'student of the first institute',
        token: (await loginAsStudent()).accessToken,
        own: first,
        other: { ...fresh, ...second },
        foreign: notFirst,
      },
      {
        name: 'guardian of the first institute',
        token: (await loginAsGuardian()).accessToken,
        own: first,
        other: { ...fresh, ...second },
        foreign: notFirst,
      },
    );

    reseller = await createSecondReseller((await loginAsPlatformAdmin()).accessToken);
    callers.push({
      name: 'reseller of the seeded institutes',
      token: (await loginAsReseller()).accessToken,
      own: first,
      other: {},
      foreign: await collectResellerIds(pool, reseller.id),
    });
    callers.push({
      name: 'reseller with no institute',
      token: reseller.token,
      own: {},
      other: first,
      foreign: new Map([...all, ...(await collectResellerIds(pool, SEED.RESELLER.id))]),
    });
  }, 240_000);

  afterAll(async () => {
    if (reseller) await removeSecondReseller(pool, reseller.id);
    await pool?.end();
    const report = process.env.TWO_INSTITUTE_REPORT;
    if (report) writeFileSync(report, JSON.stringify(outcomes, null, 1));
  });

  it('should find an id of another institute placed in a response', () => {
    const foreign = new Map([[SEED.INSTITUTE_2.id, 'institutes']]);
    expect(findForeignIds({ data: { a: [{ b: SEED.INSTITUTE_2.id }] } }, foreign)).toEqual([
      { id: SEED.INSTITUTE_2.id, source: 'institutes' },
    ]);
    expect(findForeignIds({ data: { a: SEED.INSTITUTE_1.id } }, foreign)).toEqual([]);
    // An id the request sent may be repeated in an error, never in the data.
    const sent = [SEED.INSTITUTE_2.id];
    expect(
      findForeignIds({ errors: [{ message: `${SEED.INSTITUTE_2.id} not found` }] }, foreign, sent),
    ).toEqual([]);
    expect(findForeignIds({ data: { id: SEED.INSTITUTE_2.id } }, foreign, sent)).toHaveLength(1);
  });

  it("should find the caller's own rows with the same scan", async () => {
    // Proves the id list, the generated queries and the scan meet: a caller's own lists
    // are full of its own ids, so scanning for those must find them.
    const admin = callers.find((c) => c.name === 'admin of the first institute');
    if (!admin) throw new Error('caller missing');
    const ownRows = await collectInstituteIds(pool, [SEED.INSTITUTE_1.id]);
    const found = new Set<string>();
    for (const name of ['listStudents', 'listStaff', 'standards', 'subjects', 'instituteRoles']) {
      const field = fields.find((f) => f.name === name);
      if (!field) throw new Error(`query ${name} is gone: pick another for this check`);
      const call = buildCall(field, ARGUMENT_TABLES, admin.own, 'own', DEPTH);
      const res = await gql(call.document, call.variables, admin.token);
      expect(res.errors).toBeUndefined();
      for (const hit of findForeignIds(res, ownRows)) found.add(hit.source);
    }
    expect([...found]).toEqual(
      expect.arrayContaining(['student_profiles', 'staff_profiles', 'standards', 'subjects']),
    );
  });

  it('should have every query either callable from the schema or listed with a reason', () => {
    const names = new Set(fields.map((f) => f.name));
    const unfillable: string[] = [];
    for (const field of fields) {
      if (field.name in NOT_CALLED) continue;
      try {
        buildCall(field, ARGUMENT_TABLES, {}, 'own', 0);
      } catch (error) {
        if (!(error instanceof UnfillableArgumentError)) throw error;
        unfillable.push(error.path);
      }
    }
    expect(unfillable, 'add a rule in two-institute-queries.ts for each argument').toEqual([]);
    expect(Object.keys(NOT_CALLED).filter((name) => !names.has(name))).toEqual([]);
    expect(EXPECTED_TO_FAIL.filter((name) => !names.has(name))).toEqual([]);
    expect(EXPECTED_TO_FAIL.filter((name) => name in NOT_CALLED)).toEqual([]);
  });

  // Declared before the per-query tests but reads what they recorded: see the last test.
  const answered = (name: string): boolean =>
    outcomes.some((o) => o.operation === name && o.result === 'data');

  for (const field of fields) {
    if (field.name in NOT_CALLED) continue;
    const run = EXPECTED_TO_FAIL.includes(field.name) ? it.fails : it;

    run(
      `${field.name} should return nothing of another institute`,
      async () => {
        const problems: string[] = [];
        for (const caller of callers) {
          const seen = new Set<string>();
          for (const source of ['own', 'foreign'] as const) {
            const ids = source === 'own' ? caller.own : caller.other;
            // A query with no id argument is the same call both times.
            const key = JSON.stringify(buildCall(field, ARGUMENT_TABLES, ids, source, 0).variables);
            if (seen.has(key)) continue;
            seen.add(key);
            problems.push(...(await ask(field, caller, source)));
          }
        }
        expect(problems).toEqual([]);
      },
      120_000,
    );
  }

  it('should get data from every query for at least one caller, or list why not', () => {
    // A query that only ever answers with an error was not scanned for anything.
    const platformOnly = (name: string) => name.startsWith('admin');
    const called = fields.map((f) => f.name).filter((name) => !(name in NOT_CALLED));
    const silent = called.filter(
      (name) => !answered(name) && !platformOnly(name) && !(name in WITHOUT_DATA),
    );
    expect(silent, 'fix the arguments, or add the query to WITHOUT_DATA').toEqual([]);
  });
});
