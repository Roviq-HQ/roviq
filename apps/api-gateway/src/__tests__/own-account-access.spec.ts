// Completeness check for own-account access (ROV-380). `withUser()` refuses an impersonation
// session unless the call site says `'IMPERSONATOR_MAY_READ'`. This spec holds the other half:
// every call site states its choice as a literal, and every one that lets an impersonator read
// is listed with its reason in `IMPERSONATOR_READS`.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMPERSONATOR_READS } from './own-account-access';

const ROOT = join(__dirname, '../../../..');
const SOURCE_ROOTS = ['apps', 'ee', 'libs'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '__tests__', '__test-utils__']);
/** Where `withUser` itself is defined. */
const DEFINITION = 'libs/database/src/tenant-db.ts';
const ACCESS_VALUES = ['PERSON_ONLY', 'IMPERSONATOR_MAY_READ'];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return SKIPPED_DIRS.has(entry) ? [] : sourceFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

interface CallSite {
  /** `<file>#<method>` */
  key: string;
  /** The third argument as written. */
  access: string;
}

const CALL_RE = /\bwithUser\(\s*[^,()]+,\s*[^,()]+,\s*([^,]+),/g;
const METHOD_RE = /^ {2}(?:private |protected |public )?(?:async )?(\w+)(?:<[^>]*>)?\(/gm;

function callSitesIn(file: string, source: string): CallSite[] {
  const methods = [...source.matchAll(METHOD_RE)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
  return [...source.matchAll(CALL_RE)].map((call) => {
    const at = call.index ?? 0;
    const method = methods.filter((m) => m.at < at).at(-1)?.name ?? '(top level)';
    return { key: `${file}#${method}`, access: call[1].trim() };
  });
}

function allCallSites(): { sites: CallSite[]; mentions: number } {
  const sites: CallSite[] = [];
  let mentions = 0;
  for (const root of SOURCE_ROOTS) {
    for (const full of sourceFiles(join(ROOT, root))) {
      const file = relative(ROOT, full).split(sep).join('/');
      if (file === DEFINITION) continue;
      // Comment lines mention `withUser()` without calling it.
      const source = readFileSync(full, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join('\n');
      mentions += source.match(/\bwithUser\(/g)?.length ?? 0;
      sites.push(...callSitesIn(file, source));
    }
  }
  return { sites, mentions };
}

describe('own-account access during impersonation', () => {
  const { sites, mentions } = allCallSites();

  it('should find the call sites of withUser', () => {
    expect(sites.length).toBeGreaterThan(15);
    // A call written in a shape the pattern does not read would otherwise go unchecked.
    expect(sites).toHaveLength(mentions);
  });

  it('should state the access of every call site as one of the two literals', () => {
    const undecided = sites
      .filter((site) => !ACCESS_VALUES.some((value) => site.access === `'${value}'`))
      .map((site) => `${site.key}: ${site.access}`);
    expect(undecided).toEqual([]);
  });

  it('should list every call site that lets an impersonation session read, with its reason', () => {
    const reading = sites
      .filter((site) => site.access === "'IMPERSONATOR_MAY_READ'")
      .map((site) => site.key)
      .sort();
    expect(reading).toEqual(Object.keys(IMPERSONATOR_READS).sort());
    for (const reason of Object.values(IMPERSONATOR_READS)) {
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });

  it('should notice a new call site that passes its access in a variable or lets an impersonator read', () => {
    const added = callSitesIn(
      'apps/api-gateway/src/x/x.drizzle-repository.ts',
      [
        'export class X {',
        '  async listDevices(user: SignedInUser) {',
        "    return withUser(this.db, user, 'IMPERSONATOR_MAY_READ', (tx) => tx.select());",
        '  }',
        '  async other(user: SignedInUser, access: OwnAccountAccess) {',
        '    return withUser(this.db, user, access, (tx) => tx.select());',
        '  }',
        '}',
      ].join('\n'),
    );
    expect(added).toEqual([
      {
        key: 'apps/api-gateway/src/x/x.drizzle-repository.ts#listDevices',
        access: "'IMPERSONATOR_MAY_READ'",
      },
      { key: 'apps/api-gateway/src/x/x.drizzle-repository.ts#other', access: 'access' },
    ]);
    expect(added[0].key in IMPERSONATOR_READS).toBe(false);
  });
});
