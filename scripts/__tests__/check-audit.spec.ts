import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AllowlistEntry,
  AUDIT_ALLOWLIST,
  type AuditReport,
  findAuditProblems,
  OVERRIDE_REASONS,
  parseAuditOutput,
} from '../check-audit';

const TODAY = '2026-11-28';

function advisory(id: string, module: string, severity: string): AuditReport['advisories'][string] {
  return {
    github_advisory_id: id,
    module_name: module,
    severity,
    title: `${module} problem`,
    url: `https://github.com/advisories/${id}`,
    findings: [{ version: '1.0.0', paths: [`.>parent>${module}`] }],
  };
}

function report(...advisories: AuditReport['advisories'][string][]): AuditReport {
  return { advisories: Object.fromEntries(advisories.map((a, i) => [String(i), a])) };
}

const entry = (pkg: string, reviewBy = '2027-01-31'): AllowlistEntry => ({
  package: pkg,
  reason: 'not reachable: the parser is never called',
  reviewBy,
});

const check = (
  r: AuditReport,
  allowlist: Record<string, AllowlistEntry> = {},
  overrides: Record<string, string> = {},
  reasons: Record<string, string> = {},
) => findAuditProblems(r, overrides, TODAY, allowlist, reasons);

describe('check-audit', () => {
  it('should give every override in package.json a reason, and no reason without one', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      pnpm: { overrides: Record<string, string> };
    };
    expect(Object.keys(OVERRIDE_REASONS).sort()).toEqual(Object.keys(pkg.pnpm.overrides).sort());
  });

  it('should give every allowlist entry a reason and a review date', () => {
    for (const listed of Object.values(AUDIT_ALLOWLIST)) {
      expect(listed.reason.length).toBeGreaterThan(40);
      expect(listed.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('should pass a report without advisories', () => {
    expect(check(report())).toEqual([]);
  });

  it.each(['high', 'critical'])('should fail on an unlisted %s advisory', (severity) => {
    expect(check(report(advisory('GHSA-aaaa-bbbb-cccc', 'left-pad', severity)))).toEqual([
      {
        rule: 'unlisted-advisory',
        subject: 'GHSA-aaaa-bbbb-cccc',
        detail: `${severity} in left-pad 1.0.0 via .>parent>left-pad: left-pad problem (https://github.com/advisories/GHSA-aaaa-bbbb-cccc)`,
      },
    ]);
  });

  it.each(['moderate', 'low', 'info'])('should pass an unlisted %s advisory', (severity) => {
    expect(check(report(advisory('GHSA-aaaa-bbbb-cccc', 'left-pad', severity)))).toEqual([]);
  });

  it('should pass a listed advisory before its review date', () => {
    const r = report(advisory('GHSA-aaaa-bbbb-cccc', 'left-pad', 'high'));
    expect(check(r, { 'GHSA-aaaa-bbbb-cccc': entry('left-pad', TODAY) })).toEqual([]);
  });

  it('should fail a listed advisory after its review date', () => {
    const r = report(advisory('GHSA-aaaa-bbbb-cccc', 'left-pad', 'high'));
    expect(check(r, { 'GHSA-aaaa-bbbb-cccc': entry('left-pad', '2026-11-27') })).toEqual([
      {
        rule: 'expired-entry',
        subject: 'GHSA-aaaa-bbbb-cccc',
        detail: 'review date 2026-11-27 has passed (or is not YYYY-MM-DD)',
      },
    ]);
  });

  it('should fail an entry whose date is not YYYY-MM-DD', () => {
    const r = report(advisory('GHSA-aaaa-bbbb-cccc', 'left-pad', 'high'));
    const rules = check(r, { 'GHSA-aaaa-bbbb-cccc': entry('left-pad', 'soon') }).map((p) => p.rule);
    expect(rules).toEqual(['expired-entry']);
  });

  it('should fail an entry the audit no longer reports', () => {
    expect(check(report(), { 'GHSA-aaaa-bbbb-cccc': entry('left-pad') })).toEqual([
      {
        rule: 'unused-entry',
        subject: 'GHSA-aaaa-bbbb-cccc',
        detail: 'left-pad no longer has this advisory: remove the entry',
      },
    ]);
  });

  it('should keep an entry whose advisory dropped to moderate', () => {
    const r = report(advisory('GHSA-aaaa-bbbb-cccc', 'left-pad', 'moderate'));
    expect(check(r, { 'GHSA-aaaa-bbbb-cccc': entry('left-pad') })).toEqual([]);
  });

  it('should fail an entry listed for another package', () => {
    const r = report(advisory('GHSA-aaaa-bbbb-cccc', 'right-pad', 'high'));
    expect(check(r, { 'GHSA-aaaa-bbbb-cccc': entry('left-pad') })).toEqual([
      {
        rule: 'wrong-package',
        subject: 'GHSA-aaaa-bbbb-cccc',
        detail: 'listed for left-pad, reported for right-pad',
      },
    ]);
  });

  it('should fail an override without a reason', () => {
    expect(check(report(), {}, { 'parent>left-pad': '^1.0.1' })).toEqual([
      {
        rule: 'override-without-reason',
        subject: 'parent>left-pad',
        detail: 'pnpm.overrides entry without a reason in OVERRIDE_REASONS',
      },
    ]);
  });

  it('should fail a reason whose override is gone', () => {
    expect(check(report(), {}, {}, { 'parent>left-pad': 'GHSA-aaaa-bbbb-cccc' })).toEqual([
      {
        rule: 'reason-without-override',
        subject: 'parent>left-pad',
        detail: 'OVERRIDE_REASONS names an override that package.json no longer has',
      },
    ]);
  });

  it('should pass an override with its reason', () => {
    const overrides = { 'parent>left-pad': '^1.0.1' };
    expect(check(report(), {}, overrides, { 'parent>left-pad': 'GHSA-aaaa-bbbb-cccc' })).toEqual(
      [],
    );
  });

  describe('reading the pnpm audit output', () => {
    it('should read a report', () => {
      const r = report(advisory('GHSA-aaaa-bbbb-cccc', 'left-pad', 'high'));
      expect(parseAuditOutput(JSON.stringify({ ...r, metadata: {} }), '')).toEqual({
        ...r,
        metadata: {},
      });
    });

    it('should refuse the error pnpm prints when the registry is unreachable', () => {
      const stdout = JSON.stringify({
        error: { code: 'ECONNREFUSED', message: 'request to http://127.0.0.1:9/ failed' },
      });
      expect(() => parseAuditOutput(stdout, '')).toThrow(
        'pnpm audit could not read the advisory list from the registry (ECONNREFUSED: request to http://127.0.0.1:9/ failed).',
      );
    });

    it('should refuse output that is not JSON', () => {
      expect(() => parseAuditOutput('', 'ERR_PNPM_FETCH_500')).toThrow(
        'pnpm audit printed no JSON report. Output:\nERR_PNPM_FETCH_500',
      );
    });

    it('should refuse JSON without advisories', () => {
      expect(() => parseAuditOutput('{"metadata":{}}', '')).toThrow(
        'pnpm audit printed JSON without an "advisories" object.',
      );
    });
  });
});
