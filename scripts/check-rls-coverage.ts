/**
 * CI guard — every pgTable definition must opt into RLS (or be on the
 * exempt list of platform-level user tables whose access is governed by
 * DB-role GRANTs + CASL rather than per-row RLS).
 *
 * Detects RLS via any of: `tenantPolicies(`, `entityPolicies(`,
 * `immutableEntityPolicies(`, `filePolicies(`, `userScopedPolicies(`, `pgPolicy(`.
 * drizzle-kit enables row security on any table with a policy, so the deprecated
 * `.enableRLS()` is refused rather than counted.
 *
 * Companion to `scripts/check-live-views-coverage.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const ROOT = process.cwd();
export const SCHEMA_ROOT = join(ROOT, 'libs/database/src/schema');
export const EE_SCHEMA_ROOT = join(ROOT, 'ee/libs/database/src/schema');

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', 'common']);
const SKIP_BASENAMES = new Set([
  'live-views.ts',
  'index.ts',
  'relations.ts',
  'enums.ts',
  'helpers.ts',
  'types.ts',
  'validators.ts',
  'columns.ts',
  'rls-policies.ts',
]);

// Tables allowed without RLS. Empty: adding one needs a security review first.
export const RLS_EXEMPT_BASENAMES = new Set<string>();

const RLS_INDICATORS = [
  'tenantPolicies(',
  'entityPolicies(',
  'immutableEntityPolicies(',
  'filePolicies(',
  'userScopedPolicies(',
  'pgPolicy(',
];

export function hasPgTable(text: string): boolean {
  return /\bpgTable\s*\(/.test(text);
}

export function hasRls(text: string): boolean {
  return RLS_INDICATORS.some((needle) => text.includes(needle));
}

export interface Missing {
  file: string;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (
      stat.isFile() &&
      full.endsWith('.ts') &&
      !full.endsWith('.spec.ts') &&
      !SKIP_BASENAMES.has(name)
    ) {
      out.push(full);
    }
  }
}

export function findMissingRls(schemaRoot: string): Missing[] {
  const files: string[] = [];
  walk(schemaRoot, files);
  const missing: Missing[] = [];
  for (const file of files) {
    if (RLS_EXEMPT_BASENAMES.has(basename(file))) continue;
    const text = readFileSync(file, 'utf8');
    if (!hasPgTable(text)) continue;
    if (!hasRls(text)) missing.push({ file });
  }
  return missing;
}

export function findDeprecatedEnableRls(schemaRoot: string): string[] {
  const files: string[] = [];
  walk(schemaRoot, files);
  return files.filter((file) => readFileSync(file, 'utf8').includes('.enableRLS('));
}

function main(): number {
  const deprecated = [
    ...findDeprecatedEnableRls(SCHEMA_ROOT),
    ...findDeprecatedEnableRls(EE_SCHEMA_ROOT),
  ];
  if (deprecated.length > 0) {
    process.stderr.write(
      `check:rls-coverage — ${deprecated.length} file(s) call the deprecated .enableRLS(); a table's policies enable row security. Remove the call:\n\n`,
    );
    for (const file of deprecated) process.stderr.write(`  ${relative(ROOT, file)}\n`);
    return 1;
  }
  const missing = [...findMissingRls(SCHEMA_ROOT), ...findMissingRls(EE_SCHEMA_ROOT)];
  if (missing.length === 0) {
    process.stdout.write('check:rls-coverage — every non-exempt pgTable opts into RLS.\n');
    return 0;
  }
  process.stderr.write(
    `check:rls-coverage — ${missing.length} pgTable(s) missing RLS policies. Add tenantPolicies()/entityPolicies()/userScopedPolicies()/pgPolicy(), or add the file to RLS_EXEMPT_BASENAMES with a justification:\n\n`,
  );
  for (const m of missing) {
    process.stderr.write(`  ${relative(ROOT, m.file)}\n`);
  }
  return 1;
}

// Only run main() when invoked as a script (not when imported by tests).
if (process.argv[1]?.endsWith('check-rls-coverage.ts')) {
  process.exit(main());
}
