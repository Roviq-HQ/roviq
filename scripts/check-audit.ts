// CI guard — no high or critical advisory in the production dependency tree goes unseen.
// It runs `pnpm audit --prod` (the packages under `dependencies` and what they pull in) and
// fails on a high or critical advisory that is not in AUDIT_ALLOWLIST, on an allowlist entry
// past its review date or no longer reported, and on a `pnpm.overrides` entry in package.json
// without its reason in OVERRIDE_REASONS (package.json holds no comments).
// It needs the npm registry: when the advisory list cannot be read the check fails.
// What to do with a new advisory: docs/dependency-updates.md → "Security advisories".

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AllowlistEntry {
  /** The package the advisory is reported for. */
  package: string;
  /** Why the advisory is accepted for now: the reachable code path, or why there is none. */
  reason: string;
  /** `YYYY-MM-DD`: the day the entry is looked at again. After it the check fails. */
  reviewBy: string;
}

/** Accepted high and critical advisories, keyed by GitHub advisory id. */
export const AUDIT_ALLOWLIST: Readonly<Record<string, AllowlistEntry>> = {
  'GHSA-4r6h-8v6p-xvw6': {
    package: 'xlsx',
    reason:
      'Prototype pollution when reading a crafted file. Production code only writes workbooks ' +
      '(utils.book_new, json_to_sheet, book_append_sheet and write in ' +
      'apps/api-gateway/src/institute/certificate/exports); nothing reads one. No fixed ' +
      'release on npm: SheetJS publishes fixed versions only on cdn.sheetjs.com.',
    reviewBy: '2027-01-31',
  },
  'GHSA-5pgg-2g8v-p4x9': {
    package: 'xlsx',
    reason:
      'Regular expression denial of service; the advisory does not name the code path, so ' +
      'whether the export code reaches it is not known. No fixed release on npm: SheetJS ' +
      'publishes 0.20.2 and later only on cdn.sheetjs.com. Moving to that tarball or to ' +
      'another library is an owner decision.',
    reviewBy: '2027-01-31',
  },
  'GHSA-m9gg-hp2v-232j': {
    package: '@grpc/grpc-js',
    reason:
      'Affects gRPC servers that read getAuthContext with requireClientCertificate false. ' +
      'This copy belongs to @firebase/firestore (firebase 12 pins grpc-js ~1.9.0), which no ' +
      'code imports: the web app loads firebase/app and firebase/messaging only.',
    reviewBy: '2027-02-28',
  },
  'GHSA-7mx3-vvmw-hjmv': {
    package: '@graphql-tools/utils',
    reason:
      'mergeDeep merging responses of two subgraphs (a gateway or stitched schema). The API ' +
      'serves one schema; @graphql-tools/merge calls mergeDeep only while the schema is built ' +
      'from our resolvers. @apollo/server 5.5.2 (latest) allows utils >=12.0.0 <12.0.2 and ' +
      '@nestjs/graphql 13.4.5 pins 12.0.0.',
    reviewBy: '2027-02-28',
  },
  'GHSA-c4qx-w738-7hr3': {
    package: '@graphql-tools/utils',
    reason:
      'mergeIncrementalResult, which merges @defer/@stream parts on a client. Neither ' +
      '@apollo/server, @nestjs/graphql nor our code calls it. Fixed only in 12.0.2, which ' +
      '@apollo/server 5.5.2 (latest) excludes.',
    reviewBy: '2027-02-28',
  },
};

const UNUSED_DRIZZLE_PEER =
  'An optional peer of drizzle-orm that no code uses; the lockfile kept it resolved after ' +
  'Prisma left the tree';

/** The reason for each `pnpm.overrides` entry in package.json, naming the advisory it answers. */
export const OVERRIDE_REASONS: Readonly<Record<string, string>> = {
  '@nestjs/terminus>@prisma/client':
    'An optional peer of terminus that nothing here uses; it pulled Prisma, hono, mysql2, ' +
    'effect and deepmerge-ts into the tree (GHSA-q5qw-h33p-qvwr, GHSA-88fw-hqm2-52qc, ' +
    'GHSA-3f6p-5ww8-9rcr, GHSA-38f7-945m-qr2g, GHSA-ggr8-5vv4-36mx and more).',
  'drizzle-orm>mssql':
    'drizzle-orm 1.0 beta declares the SQL Server driver a required peer; the app uses pg ' +
    'only. It pulled tedious and @azure/msal-node (GHSA-xcx6-jx8p-x3h5).',
  'drizzle-orm>@types/mssql': 'As drizzle-orm>mssql: a required peer that pulled tedious.',
  'drizzle-orm>@electric-sql/pglite': UNUSED_DRIZZLE_PEER,
  'drizzle-orm>better-sqlite3': UNUSED_DRIZZLE_PEER,
  'drizzle-orm>mysql2': `${UNUSED_DRIZZLE_PEER} (GHSA-3f6p-5ww8-9rcr)`,
  'drizzle-orm>postgres': UNUSED_DRIZZLE_PEER,
  'drizzle-orm>valibot': `${UNUSED_DRIZZLE_PEER} (GHSA-5qjj-4xww-7phc)`,
  'cashfree-pg>axios':
    'cashfree-pg 5.1.3 (latest 5.x) pins axios 1.15.0, which the Cashfree adapter uses for ' +
    'every API call (GHSA-pmwg-cvhr-8vh7, GHSA-pf86-5x62-jrwf, GHSA-3pq3-5fj3-cg6v and more). ' +
    'cashfree-pg 6 is a major that adds @sentry/node.',
  '@nestjs/config>lodash':
    '@nestjs/config 4.0.x (latest for Nest 11) pins lodash 4.17.23 (GHSA-r5fr-rjxr-66jc).',
};

const GATED = new Set(['high', 'critical']);

/** The parts of `pnpm audit --json` this check reads. */
export interface AuditReport {
  advisories: Record<
    string,
    {
      github_advisory_id: string;
      module_name: string;
      severity: string;
      title: string;
      url: string;
      findings: { version: string; paths: string[] }[];
    }
  >;
}

export type AuditRule =
  | 'unlisted-advisory'
  | 'expired-entry'
  | 'unused-entry'
  | 'wrong-package'
  | 'override-without-reason'
  | 'reason-without-override';

export interface AuditProblem {
  rule: AuditRule;
  /** The advisory id or the override selector. */
  subject: string;
  detail: string;
}

/** The advisory report from `pnpm audit` output; throws with a readable message otherwise. */
export function parseAuditOutput(stdout: string, stderr: string): AuditReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `pnpm audit printed no JSON report. Output:\n${(stdout + stderr).trim() || '(none)'}`,
    );
  }
  if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
    const { error } = parsed as { error: { code?: string; message?: string } };
    throw new Error(
      `pnpm audit could not read the advisory list from the registry ` +
        `(${error.code ?? 'no code'}: ${error.message ?? 'no message'}).`,
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('advisories' in parsed) ||
    typeof parsed.advisories !== 'object' ||
    parsed.advisories === null
  ) {
    throw new Error('pnpm audit printed JSON without an "advisories" object.');
  }
  return parsed as AuditReport;
}

export function findAuditProblems(
  report: AuditReport,
  overrides: Readonly<Record<string, string>>,
  today: string,
  allowlist: Readonly<Record<string, AllowlistEntry>> = AUDIT_ALLOWLIST,
  overrideReasons: Readonly<Record<string, string>> = OVERRIDE_REASONS,
): AuditProblem[] {
  const problems: AuditProblem[] = [];
  const reported = new Map<string, string>();

  for (const advisory of Object.values(report.advisories)) {
    const id = advisory.github_advisory_id;
    reported.set(id, advisory.module_name);
    if (!GATED.has(advisory.severity)) continue;
    const entry = allowlist[id];
    if (entry === undefined) {
      const finding = advisory.findings[0];
      const where = finding ? `${finding.version} via ${finding.paths[0] ?? '?'}` : '';
      problems.push({
        rule: 'unlisted-advisory',
        subject: id,
        detail: `${advisory.severity} in ${advisory.module_name} ${where}: ${advisory.title} (${advisory.url})`,
      });
    } else if (entry.package !== advisory.module_name) {
      problems.push({
        rule: 'wrong-package',
        subject: id,
        detail: `listed for ${entry.package}, reported for ${advisory.module_name}`,
      });
    }
  }

  for (const [id, entry] of Object.entries(allowlist)) {
    if (!reported.has(id)) {
      problems.push({
        rule: 'unused-entry',
        subject: id,
        detail: `${entry.package} no longer has this advisory: remove the entry`,
      });
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy) || entry.reviewBy < today) {
      problems.push({
        rule: 'expired-entry',
        subject: id,
        detail: `review date ${entry.reviewBy} has passed (or is not YYYY-MM-DD)`,
      });
    }
  }

  for (const selector of Object.keys(overrides)) {
    if (overrideReasons[selector] === undefined) {
      problems.push({
        rule: 'override-without-reason',
        subject: selector,
        detail: 'pnpm.overrides entry without a reason in OVERRIDE_REASONS',
      });
    }
  }
  for (const selector of Object.keys(overrideReasons)) {
    if (overrides[selector] === undefined) {
      problems.push({
        rule: 'reason-without-override',
        subject: selector,
        detail: 'OVERRIDE_REASONS names an override that package.json no longer has',
      });
    }
  }
  return problems;
}

function readOverrides(root: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    pnpm?: { overrides?: Record<string, string> };
  };
  return pkg.pnpm?.overrides ?? {};
}

function main(): number {
  const root = process.cwd();
  const audit = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (audit.error) {
    process.stderr.write(`check:audit — could not run pnpm audit: ${audit.error.message}\n`);
    return 1;
  }
  let report: AuditReport;
  try {
    report = parseAuditOutput(audit.stdout, audit.stderr);
  } catch (err) {
    process.stderr.write(
      `check:audit — ${err instanceof Error ? err.message : String(err)}\n` +
        'The check needs the npm registry and does not pass without it. Run it again once ' +
        'the registry answers.\n',
    );
    return 1;
  }

  const today = new Date().toISOString().slice(0, 10);
  const problems = findAuditProblems(report, readOverrides(root), today);
  if (problems.length === 0) {
    process.stdout.write(
      'check:audit — no high or critical advisory in the production dependencies outside the allowlist.\n',
    );
    return 0;
  }
  process.stderr.write(`check:audit — ${problems.length} problem(s):\n\n`);
  for (const problem of problems) {
    process.stderr.write(`  ${problem.rule}  ${problem.subject}\n    ${problem.detail}\n`);
  }
  process.stderr.write(
    '\nWhat to do: docs/dependency-updates.md → "Security advisories". Lists: ' +
      'AUDIT_ALLOWLIST and OVERRIDE_REASONS in scripts/check-audit.ts.\n',
  );
  return 1;
}

if (process.argv[1]?.endsWith('check-audit.ts')) {
  process.exit(main());
}
