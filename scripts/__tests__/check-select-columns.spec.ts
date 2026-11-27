import { describe, expect, it } from 'vitest';
import {
  BASELINE_FILE,
  buildBaseline,
  compare,
  findWholeRowQueries,
  parseBaseline,
  scan,
  type Violation,
} from '../check-select-columns';

const FILE = 'apps/api-gateway/src/institute/student/repositories/student.drizzle-repository.ts';

const found = (source: string) =>
  findWholeRowQueries(FILE, source).map(({ line, call, table }) => ({ line, call, table }));

describe('check-select-columns: finding whole-row queries', () => {
  it('should find select() with no argument and name the table of its from()', () => {
    const source = `const rows = await tx
  .select()
  .from(studentProfilesLive)
  .where(eq(studentProfilesLive.id, id));`;
    expect(found(source)).toEqual([{ line: 2, call: 'select', table: 'studentProfiles' }]);
  });

  it('should find a one-line select() on a base table', () => {
    const source = 'return tx.select().from(plans).limit(1);';
    expect(found(source)).toEqual([{ line: 1, call: 'select', table: 'plans' }]);
  });

  it('should find returning() with no argument after an insert, an update and a delete', () => {
    const source = `await tx.insert(staffProfiles).values(data).returning();
await tx
  .update(userDocuments)
  .set({ type })
  .where(eq(userDocuments.id, id))
  .returning();
await tx.delete(schema.plans).returning();`;
    expect(found(source)).toEqual([
      { line: 1, call: 'returning', table: 'staffProfiles' },
      { line: 6, call: 'returning', table: 'userDocuments' },
      { line: 7, call: 'returning', table: 'plans' },
    ]);
  });

  it('should report a table it cannot name as null', () => {
    const source = 'const rows = await tx.select().from(tableFor(kind));';
    expect(found(source)).toEqual([{ line: 1, call: 'select', table: null }]);
  });

  it('should accept a query that names its columns', () => {
    const source = `await tx.select({ id: users.id }).from(users);
await tx.select(namedColumns(staffProfilesLive, STAFF_PROFILE_COLUMNS)).from(staffProfilesLive);
await tx.insert(users).values(data).returning({ id: users.id });
await tx.update(users).set(data);`;
    expect(found(source)).toEqual([]);
  });
});

describe('check-select-columns: comparing with the baseline', () => {
  const onPlans: Violation = { file: 'ee/a.ts', line: 3, call: 'select', table: 'plans' };
  const onStudents: Violation = {
    file: 'apps/b.ts',
    line: 9,
    call: 'returning',
    table: 'studentProfiles',
  };

  it('should pass when every file matches its baseline count', () => {
    expect(compare([onPlans, { ...onPlans, line: 8 }], { 'ee/a.ts': 2 })).toEqual([]);
  });

  it('should refuse a whole-row query on a listed table even when the baseline names the file', () => {
    const failures = compare([onStudents], { 'apps/b.ts': 1 });
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain('apps/b.ts:9  returning() on studentProfiles');
    // The baseline never holds a listed table, so the entry itself is stale.
    expect(failures[1]).toContain(`remove its entry from ${BASELINE_FILE}`);
  });

  it('should refuse a file that is not in the baseline', () => {
    const failures = compare([onPlans], {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('ee/a.ts: 1 whole-row query(ies) (file not in the baseline)');
  });

  it('should refuse a file above its count', () => {
    const failures = compare([onPlans, { ...onPlans, line: 8 }], { 'ee/a.ts': 1 });
    expect(failures[0]).toContain('2 whole-row query(ies), baseline allows 1');
  });

  it('should ask for a lower entry when a file is below its count', () => {
    const failures = compare([onPlans], { 'ee/a.ts': 2 });
    expect(failures[0]).toContain(`lower its entry in ${BASELINE_FILE} to 1`);
  });

  it('should leave listed tables out of the baseline it writes', () => {
    expect(buildBaseline([onPlans, onStudents])).toEqual({ 'ee/a.ts': 1 });
  });

  it('should refuse a baseline entry that is not a positive whole number', () => {
    expect(() => parseBaseline('{"a.ts": 0}')).toThrow('positive whole number');
  });
});

describe('check-select-columns: this repository', () => {
  it('should hold no whole-row query on a listed table, and match the baseline', async () => {
    const { readFileSync } = await import('node:fs');
    const baseline = parseBaseline(readFileSync(BASELINE_FILE, 'utf8'));
    expect(compare(scan(process.cwd()), baseline)).toEqual([]);
  });
});
