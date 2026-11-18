/**
 * CI guard — fails when application code reads from a soft-deletable base
 * table instead of its `*_live` view.
 *
 * Background: every soft-deletable tenant table has a corresponding
 * `<table>_live` security_invoker view exported from `@roviq/database`.
 * Repositories and services that should hide trashed rows MUST read through
 * the view; writes (`.insert`, `.update`, `.delete`, `softDelete`) target the
 * base table.
 *
 * This script scans `apps/` and `ee/apps/` for `.from(<baseTable>)` and
 * `.<kind>Join(<baseTable>, …)` where
 * `<baseTable>` is a known soft-deletable name. Allowed exceptions:
 *   1. The line is part of an INSERT/UPDATE/DELETE chain (write-side).
 *   2. The file lives under `**\/__tests__\/**` (mocks aren't enforced).
 *   3. The line carries a trailing `// allow-base-read: <reason>` comment.
 *   4. The file lives under `libs/database` (the schema layer itself).
 *
 * Biome doesn't support custom rules, so this is a standalone pnpm script
 * wired into the CI lint job (or run locally via `pnpm check:live-views`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  EE_LIVE_VIEWS_FILE,
  LIVE_VIEWS_FILE,
  loadLiveViewExports,
} from './check-live-views-coverage';

const ROOT = process.cwd();

// Derived from the `*Live` exports so a new view is enforced without editing this file.
const SOFT_DELETABLE_TABLES = [
  ...loadLiveViewExports(LIVE_VIEWS_FILE),
  ...loadLiveViewExports(EE_LIVE_VIEWS_FILE),
].map((name) => name.slice(0, -'Live'.length));

const SCAN_ROOTS = [
  'apps/api-gateway/src',
  'ee/apps/api-gateway/src',
  'apps/notification-service/src',
];

interface Hit {
  file: string;
  line: number;
  text: string;
  table: string;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === '__tests__' || name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile() && full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
}

function listFiles(): string[] {
  const all: string[] = [];
  for (const root of SCAN_ROOTS) {
    walk(join(ROOT, root), all);
  }
  return all;
}

export function findBaseTableReads(text: string, tables: readonly string[]): Omit<Hit, 'file'>[] {
  const lines = text.split('\n');
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length;
  const hits: Omit<Hit, 'file'>[] = [];
  for (const table of tables) {
    // `\s*` spans newlines: Biome wraps long joins so the table lands on the
    // line after `.leftJoin(`. Trailing `)` or `,` avoids matching `<table>Live`.
    const re = new RegExp(`\\.(from|\\w+Join)\\(\\s*${table}\\s*[),]`, 'g');
    for (const match of text.matchAll(re)) {
      const start = lineAt(match.index);
      const end = lineAt(match.index + match[0].length);
      if (lines.slice(start - 1, end).some((l) => l.includes('// allow-base-read'))) continue;
      hits.push({ line: end, text: lines[end - 1].trim(), table });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

function scan(file: string): Hit[] {
  return findBaseTableReads(readFileSync(file, 'utf8'), SOFT_DELETABLE_TABLES).map((h) => ({
    file,
    ...h,
  }));
}

function main(): number {
  const files = listFiles();
  const hits: Hit[] = [];
  for (const f of files) {
    hits.push(...scan(f));
  }
  if (hits.length === 0) {
    process.stdout.write('check:live-views — no offending base-table reads found.\n');
    return 0;
  }
  process.stderr.write(
    `check:live-views — ${hits.length} base-table read(s) found. Use the *_live view or annotate with \`// allow-base-read: <reason>\`:\n\n`,
  );
  for (const hit of hits) {
    process.stderr.write(`  ${relative(ROOT, hit.file)}:${hit.line}  ${hit.table}\n`);
    process.stderr.write(`    ${hit.text}\n`);
  }
  return 1;
}

// Only run main() when invoked as a script (not when imported by tests).
if (process.argv[1]?.endsWith('check-live-views.ts')) {
  process.exit(main());
}
