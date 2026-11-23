// CI guard — a `*.service.ts` file must not query the database. Services hold the rules;
// every query lives in a repository, where tenant isolation is reviewed in one place and the
// SQL is tested against the real database instead of a mocked transaction.
//
// A service may import TYPES from `@roviq/database` (`import type`, or `type X` specifiers)
// and the few plain constants in ALLOWED_VALUE_IMPORTS. Anything else from `@roviq/database`,
// and any import from `drizzle-orm`, fails.

import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = [join(ROOT, 'apps'), join(ROOT, 'ee')];

/** Values exported by `@roviq/database` that are not a way to reach the database. */
export const ALLOWED_VALUE_IMPORTS: ReadonlySet<string> = new Set([
  'SYSTEM_USER_ID',
  // Pure helpers: pick a display string from an i18n object, validate a contact object.
  'i18nDisplay',
  'instituteContactSchema',
]);

/** Services allowed to query directly, each with its reason. Keep it empty. */
export const SERVICE_DB_ALLOWLIST: Readonly<Record<string, string>> = {};

const IMPORT_RE = /import\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/gs;

export interface Violation {
  module: string;
  names: string[];
}

/** Value imports in `source` that reach the database. */
export function findDbImports(source: string): Violation[] {
  const violations: Violation[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const [, typeOnly, clause, module] = match;
    if (typeOnly || clause === undefined || module === undefined) continue;
    const isDrizzle = module === 'drizzle-orm' || module.startsWith('drizzle-orm/');
    if (module !== '@roviq/database' && !isDrizzle) continue;

    const names: string[] = [];
    const braces = clause.match(/\{([^}]*)\}/s);
    const outside = clause
      .replace(/\{[^}]*\}/s, '')
      .replace(/,/g, ' ')
      .trim();
    if (outside) names.push(outside);
    for (const raw of braces?.[1]?.split(',') ?? []) {
      const spec = raw.trim();
      if (!spec || spec.startsWith('type ')) continue;
      const name = spec.split(/\s+as\s+/)[0]?.trim();
      if (name && !(module === '@roviq/database' && ALLOWED_VALUE_IMPORTS.has(name))) {
        names.push(name);
      }
    }
    if (names.length > 0) violations.push({ module, names });
  }
  return violations;
}

function walk(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name === 'node_modules' || name === 'dist' || name === '.next' || name === '__tests__') {
      continue;
    }
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && name.endsWith('.service.ts')) out.push(full);
  }
}

function main(): void {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(root, files);

  const failures: string[] = [];
  const seen = new Set<string>();
  for (const file of files.sort()) {
    const path = relative(ROOT, file);
    seen.add(path);
    if (path in SERVICE_DB_ALLOWLIST) continue;
    for (const v of findDbImports(readFileSync(file, 'utf8'))) {
      failures.push(`${path}: imports ${v.names.join(', ')} from '${v.module}'`);
    }
  }
  for (const path of Object.keys(SERVICE_DB_ALLOWLIST)) {
    if (!seen.has(path)) failures.push(`${path}: on SERVICE_DB_ALLOWLIST but the file is gone`);
  }

  if (failures.length > 0) {
    console.error('Services must not query the database; move the query into a repository:\n');
    for (const line of failures) console.error(`  ${line}`);
    console.error(
      `\n${failures.length} problem(s). See .claude/skills/backend-service/SKILL.md → "Resolvers, services, repositories".`,
    );
    process.exit(1);
  }
  console.log(`check:service-db-access OK (${files.length} service files)`);
}

if (process.argv[1]?.endsWith('check-service-db-access.ts')) main();
