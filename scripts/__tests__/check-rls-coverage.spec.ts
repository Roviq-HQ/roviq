import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findDeprecatedEnableRls,
  findMissingRls,
  hasPgTable,
  hasRls,
  RLS_EXEMPT_BASENAMES,
} from '../check-rls-coverage';

describe('hasPgTable', () => {
  it('returns true for a pgTable definition', () => {
    expect(hasPgTable("export const t = pgTable('t', {})")).toBe(true);
  });

  it('returns true with whitespace before paren', () => {
    expect(hasPgTable('export const t = pgTable (')).toBe(true);
  });

  it('returns false when pgTable is absent', () => {
    expect(hasPgTable('export const t = 1;')).toBe(false);
  });
});

describe('hasRls', () => {
  it('detects tenantPolicies', () => {
    expect(hasRls("...tenantPolicies('foo'),")).toBe(true);
  });

  it('detects entityPolicies', () => {
    expect(hasRls("...entityPolicies('foo'),")).toBe(true);
  });

  it('detects immutableEntityPolicies', () => {
    expect(hasRls("...immutableEntityPolicies('foo'),")).toBe(true);
  });

  it('detects pgPolicy', () => {
    expect(hasRls("pgPolicy('foo', { ... })")).toBe(true);
  });

  it('detects userScopedPolicies', () => {
    expect(hasRls("...userScopedPolicies('user_profiles'),")).toBe(true);
  });

  it('detects filePolicies', () => {
    expect(hasRls("...filePolicies('files'),")).toBe(true);
  });

  it('does not count the deprecated .enableRLS() alone (ROV-218)', () => {
    expect(hasRls(').enableRLS();')).toBe(false);
  });

  it('returns false when no indicator is present', () => {
    expect(hasRls("export const t = pgTable('t', {})")).toBe(false);
  });
});

describe('RLS_EXEMPT_BASENAMES', () => {
  it('should be empty: every table has RLS (ROV-279)', () => {
    expect([...RLS_EXEMPT_BASENAMES]).toEqual([]);
  });

  it('does not contain typical tenant business tables', () => {
    expect(RLS_EXEMPT_BASENAMES.has('subjects.ts')).toBe(false);
    expect(RLS_EXEMPT_BASENAMES.has('institutes.ts')).toBe(false);
  });
});

describe('findMissingRls', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rlscov-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty when all pgTables have RLS', () => {
    writeFileSync(
      join(dir, 'subjects.ts'),
      `export const subjects = pgTable('subjects', {}, t => [...tenantPolicies('subjects')]);`,
    );
    expect(findMissingRls(dir)).toEqual([]);
  });

  it('flags a pgTable with no RLS indicators', () => {
    const file = join(dir, 'orphan.ts');
    writeFileSync(file, `export const orphan = pgTable('orphan', {});`);
    const missing = findMissingRls(dir);
    expect(missing).toHaveLength(1);
    expect(missing[0].file).toBe(file);
  });

  it('reports a formerly exempt table that has no RLS (ROV-279)', () => {
    const file = join(dir, 'phone-numbers.ts');
    writeFileSync(file, `export const phoneNumbers = pgTable('phone_numbers', {});`);
    expect(findMissingRls(dir)).toEqual([{ file }]);
  });

  it('skips files that contain no pgTable call', () => {
    writeFileSync(join(dir, 'helpers-here.ts'), `export const x = 1;`);
    expect(findMissingRls(dir)).toEqual([]);
  });

  it('returns empty when the schema root does not exist', () => {
    expect(findMissingRls(join(dir, 'does-not-exist'))).toEqual([]);
  });

  it('walks nested subdirectories', () => {
    const sub = join(dir, 'tenant');
    mkdirSync(sub);
    writeFileSync(join(sub, 'orphan.ts'), `export const orphan = pgTable('orphan', {});`);
    const missing = findMissingRls(dir);
    expect(missing).toHaveLength(1);
  });

  it('skips index.ts and other SKIP_BASENAMES files', () => {
    writeFileSync(join(dir, 'index.ts'), `export const ghost = pgTable('ghost', {});`);
    expect(findMissingRls(dir)).toEqual([]);
  });
});

describe('findDeprecatedEnableRls', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rlscov-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('flags a schema file that still calls .enableRLS()', () => {
    const file = join(dir, 'groups.ts');
    writeFileSync(
      file,
      `export const g = pgTable('g', {}, () => [pgPolicy('p', {})]).enableRLS();`,
    );
    expect(findDeprecatedEnableRls(dir)).toEqual([file]);
  });

  it('flags the call when it is chained on its own line', () => {
    const file = join(dir, 'groups.ts');
    writeFileSync(
      file,
      `export const g = pgTable('g', {}, () => [pgPolicy('p', {})])\n  .enableRLS();`,
    );
    expect(findDeprecatedEnableRls(dir)).toEqual([file]);
  });

  it('leaves a table whose only marker is .enableRLS() to findMissingRls', () => {
    const file = join(dir, 'orphan.ts');
    writeFileSync(file, `export const orphan = pgTable('orphan', {}).enableRLS();`);
    expect(findMissingRls(dir)).toEqual([{ file }]);
  });

  it('returns empty when no file calls it', () => {
    writeFileSync(
      join(dir, 'groups.ts'),
      `export const g = pgTable('g', {}, () => [pgPolicy('p', {})]);`,
    );
    expect(findDeprecatedEnableRls(dir)).toEqual([]);
  });
});
