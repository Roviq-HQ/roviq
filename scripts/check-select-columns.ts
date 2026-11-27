// CI guard: a query names the columns it returns (ROV-391).
//
// `tx.select().from(table)` and `.returning()` with no argument return every column the table
// has, also one added later. A violation is either call with no argument, in a non-test `.ts`
// file under the scanned roots. The table is the argument of the `.from(…)` that follows a
// `select()`, or of the `.insert(…)` / `.update(…)` / `.delete(…)` a `returning()` belongs to;
// a `…Live` view counts as its table.
//
// Two levels:
//   - A table in `SENSITIVE_TABLES` (personal data, credentials, secrets): always refused.
//   - Any other table: counted per file against `scripts/select-columns-baseline.json`. A file
//     missing from it, or above its count, fails; a file below its count also fails until the
//     entry is lowered or removed, so the list only shrinks. `--write-baseline` rewrites the
//     file from the current code: for lowering counts only, never for adding a file.
//
// Instead: `tx.select({ id: t.id, … })`, `.returning({ id: t.id })`, or a shared column object
// declared beside the repository (`const studentColumns = { … }`).
//
// Run via `pnpm check:select-columns`.

import { type Dirent, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
export const BASELINE_FILE = 'scripts/select-columns-baseline.json';

/** Application code that queries the database. The schema folder declares views and the seed folder fills a new database: neither answers a request. */
export const SCAN_ROOTS = ['apps', 'ee/apps', 'ee/libs', 'libs/backend', 'libs/database/src'];
const SKIP_DIRS = new Set(['__tests__', 'node_modules', '.next', 'dist', 'schema', 'seed', 'web']);

/**
 * Tables whose rows hold personal data, credentials or secrets, by their Drizzle export name.
 * A whole-row read or `returning()` of one is refused outright.
 */
export const SENSITIVE_TABLES: ReadonlySet<string> = new Set([
  'users',
  'userProfiles',
  'tenantUserProfiles',
  'userIdentifiers',
  'userDocuments',
  'userAddresses',
  'phoneNumbers',
  'studentProfiles',
  'staffProfiles',
  'guardianProfiles',
  'authProviders',
  'refreshTokens',
  'impersonationSessions',
  'deviceTokens',
  'messagingSenderSecrets',
  'gatewayConfigs',
]);

export const FIX_HINT =
  'Name the columns: tx.select({ id: t.id, … }) / .returning({ id: t.id }), or a column object ' +
  'declared beside the repository (docs/references/mistakes.md → "Whole-row queries").';

export interface Violation {
  file: string;
  line: number;
  /** `select` or `returning`. */
  call: 'select' | 'returning';
  /** The table's export name without `Live`, or null when it is not a plain name. */
  table: string | null;
}

export type Baseline = Record<string, number>;

const WRITES: ReadonlySet<string> = new Set(['insert', 'update', 'delete']);

function tableName(arg: ts.Expression | undefined): string | null {
  if (!arg) return null;
  const name = ts.isIdentifier(arg)
    ? arg.text
    : ts.isPropertyAccessExpression(arg)
      ? arg.name.text
      : null;
  return name === null ? null : name.replace(/Live$/, '');
}

function methodName(call: ts.CallExpression): string | null {
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;
}

/** The table of the `.from(…)` chained directly or later on a `select()` call. */
function tableOfSelect(select: ts.CallExpression): string | null {
  let node: ts.Node = select;
  while (ts.isPropertyAccessExpression(node.parent) && ts.isCallExpression(node.parent.parent)) {
    const call = node.parent.parent;
    if (methodName(call) === 'from') return tableName(call.arguments[0]);
    node = call;
  }
  return null;
}

/** The table of the `.insert(…)`, `.update(…)` or `.delete(…)` a `returning()` call ends. */
function tableOfReturning(returning: ts.CallExpression): string | null {
  let node: ts.Expression = returning.expression;
  while (ts.isPropertyAccessExpression(node)) {
    const inner = node.expression;
    if (!ts.isCallExpression(inner)) return null;
    const name = methodName(inner);
    if (name && WRITES.has(name)) return tableName(inner.arguments[0]);
    node = inner.expression;
  }
  return null;
}

/** Every whole-row `select()` and `returning()` in one file, sorted by line. */
export function findWholeRowQueries(file: string, text: string): Violation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length === 0) {
      const name = methodName(node);
      if (name === 'select' || name === 'returning') {
        found.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.expression.getEnd()).line + 1,
          call: name,
          table: name === 'select' ? tableOfSelect(node) : tableOfReturning(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.sort((a, b) => a.line - b.line);
}

export function isSensitive(violation: Violation): boolean {
  return violation.table !== null && SENSITIVE_TABLES.has(violation.table);
}

/** Counts per file of the violations a baseline may hold: those on a table not listed. */
export function buildBaseline(violations: readonly Violation[]): Baseline {
  const counts: Baseline = {};
  for (const v of violations) {
    if (isSensitive(v)) continue;
    counts[v.file] = (counts[v.file] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

const site = (v: Violation): string =>
  `    ${v.file}:${v.line}  ${v.call}() on ${v.table ?? 'a table the check cannot name'}`;

/** Failure messages: every sensitive-table violation, then each file that differs from the baseline. */
export function compare(violations: readonly Violation[], baseline: Baseline): string[] {
  const failures: string[] = [];
  const sensitive = violations.filter(isSensitive);
  if (sensitive.length > 0) {
    failures.push(
      `  ${sensitive.length} whole-row query(ies) on a table that holds personal data or secrets:\n` +
        `${sensitive.map(site).join('\n')}\n    ${FIX_HINT}`,
    );
  }

  const rest = violations.filter((v) => !isSensitive(v));
  const found = buildBaseline(rest);
  const files = [...new Set([...Object.keys(found), ...Object.keys(baseline)])].sort();
  for (const file of files) {
    const count = found[file] ?? 0;
    const allowed = baseline[file];
    const sites = rest
      .filter((v) => v.file === file)
      .map(site)
      .join('\n');
    if (allowed === undefined) {
      failures.push(
        `  ${file}: ${count} whole-row query(ies) (file not in the baseline).\n${sites}\n    ${FIX_HINT}`,
      );
    } else if (count > allowed) {
      failures.push(
        `  ${file}: ${count} whole-row query(ies), baseline allows ${allowed}.\n${sites}\n    ${FIX_HINT}`,
      );
    } else if (count < allowed) {
      const fix =
        count === 0
          ? `remove its entry from ${BASELINE_FILE}`
          : `lower its entry in ${BASELINE_FILE} to ${count}`;
      failures.push(
        `  ${file}: ${count} whole-row query(ies), baseline says ${allowed}. Good: ${fix} ` +
          '(or run pnpx tsx scripts/check-select-columns.ts --write-baseline).',
      );
    }
  }
  return failures;
}

export function parseBaseline(text: string | null): Baseline {
  if (text === null) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${BASELINE_FILE} must be an object of "<path>": <count>`);
  }
  const baseline: Baseline = {};
  for (const [file, count] of Object.entries(parsed)) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      throw new Error(`${BASELINE_FILE}: "${file}" must map to a positive whole number`);
    }
    baseline[file] = count;
  }
  return baseline;
}

function isScanned(name: string): boolean {
  return name.endsWith('.ts') && !name.endsWith('.d.ts') && !/\.spec\.ts$/.test(name);
}

function walkFiles(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.endsWith('-e2e')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile() && isScanned(entry.name)) out.push(full);
  }
}

/** Every violation under the scanned roots, by repo-relative path. */
export function scan(root: string): Violation[] {
  const paths: string[] = [];
  for (const scanRoot of SCAN_ROOTS) walkFiles(join(root, scanRoot), paths);
  return paths
    .sort()
    .flatMap((path) => findWholeRowQueries(relative(root, path), readFileSync(path, 'utf8')));
}

function main(): void {
  const violations = scan(ROOT);
  const baselinePath = resolve(ROOT, BASELINE_FILE);

  if (process.argv.includes('--list')) {
    for (const v of violations) console.log(site(v).trim());
    return;
  }

  if (process.argv.includes('--write-baseline')) {
    const baseline = buildBaseline(violations);
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    const total = Object.values(baseline).reduce((sum, n) => sum + n, 0);
    console.log(
      `check:select-columns: wrote ${BASELINE_FILE} (${Object.keys(baseline).length} file(s), ${total} query(ies))`,
    );
    return;
  }

  const baseline = parseBaseline(
    existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8') : null,
  );
  const failures = compare(violations, baseline);
  if (failures.length > 0) {
    console.error(
      `check:select-columns: a query must name the columns it returns.\n\n${failures.join('\n\n')}`,
    );
    process.exit(1);
  }
  const total = Object.values(baseline).reduce((sum, n) => sum + n, 0);
  console.log(
    `check:select-columns: no whole-row query on a listed table; ${total} left elsewhere in ${Object.keys(baseline).length} file(s) (${BASELINE_FILE}).`,
  );
}

if (process.argv[1]?.endsWith('check-select-columns.ts')) main();
