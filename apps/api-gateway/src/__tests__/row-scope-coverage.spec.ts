// Completeness check for row conditions (ROV-376). `AbilityGuard` refuses a caller whose rule
// on the checked pair carries a condition unless the operation declares `rows: 'scoped'`.
// This spec holds the other half: an operation a default role can only reach with a condition
// must make the declaration (or say why not), every declaration names its proof in
// `ROW_SCOPE_COVERAGE`, a declared handler really receives the caller's ability, and every
// field and `$user.…` variable of a conditional rule is one the code can evaluate.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createMongoAbility } from '@casl/ability';
import { substituteUserVars } from '@roviq/casl';
import {
  type AbilityRule,
  type AppAbility,
  type AppAction,
  DEFAULT_ROLE_ABILITIES,
} from '@roviq/common-types';
import { leavesLive, reportCardInstancesLive, sectionsLive } from '@roviq/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { sectionInScope } from '../institute/attendance/repositories/attendance-scope';
import { reportCardInstanceInScope } from '../institute/examination/repositories/report-card-scope';
import { guardianLinkedReadPredicate } from '../institute/guardian/guardian-read-predicate';
import { leaveInScope, mayApplyFor } from '../institute/leave/repositories/leave-scope';
import { studentReadPredicate } from '../institute/student/student-read-predicate';
import { ROW_SCOPE_COVERAGE, ROW_SCOPE_UNDECLARED, type RowScopeHow } from './row-scope-coverage';

const ROOT = join(__dirname, '../../../..');
const RESOLVER_ROOTS = ['apps/api-gateway/src', 'ee/apps/api-gateway/src'];
/** Platform and reseller resolvers: an institute role is stopped by the scope guard. */
const OTHER_SCOPE_DIRS = ['admin', 'reseller'];

function resolverFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'node_modules' || entry === '__tests__' ? [] : resolverFiles(full);
    }
    return entry.endsWith('.resolver.ts') ? [full] : [];
  });
}

interface GuardedOperation {
  name: string;
  file: string;
  action: string;
  subject: string;
  scoped: boolean;
  /** The handler with its decorators and parameters. */
  source: string;
}

const GUARDED_RE =
  /@CheckAbility\(\{\s*action:\s*'([a-z_]+)',\s*subject:\s*'(\w+)'(,\s*rows:\s*'scoped')?\s*\}\)\n(?:\s*(?:@|\/\/)[^\n]*\n)*\s*(?:async\s+)?(\w+)\(/g;

function guardedOperations(): GuardedOperation[] {
  const operations: GuardedOperation[] = [];
  for (const root of RESOLVER_ROOTS) {
    for (const file of resolverFiles(join(ROOT, root))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(GUARDED_RE)) {
        const [, action, subject, scoped, name] = match;
        const at = match.index ?? 0;
        const start = source.lastIndexOf('\n\n', at);
        const end = source.indexOf('\n  }\n', at);
        if (!action || !subject || !name) continue;
        operations.push({
          name,
          file: relative(ROOT, file).split(sep).join('/'),
          action,
          subject,
          scoped: scoped !== undefined,
          source: source.slice(start, end),
        });
      }
    }
  }
  return operations;
}

const covers = (rule: AbilityRule, action: string, subject: string) =>
  !rule.inverted &&
  (rule.action === action || rule.action === 'manage') &&
  (rule.subject === subject || rule.subject === 'all');

/** Default roles that hold the pair, and hold it only through rules with a condition. */
function rolesWithConditionOnly(action: string, subject: string): string[] {
  return Object.entries(DEFAULT_ROLE_ABILITIES)
    .filter(([, rules]) => {
      const allowing = rules.filter((rule) => covers(rule, action, subject));
      return allowing.length > 0 && allowing.every((rule) => rule.conditions);
    })
    .map(([role]) => role);
}

const HANDLER_RECEIVES: Readonly<Record<RowScopeHow, RegExp>> = {
  predicate: /@CurrentAbility\(\)|@CurrentReadAccess\(\)/,
  'row-check': /@CurrentAbility\(\)|@CurrentReadAccess\(\)/,
  'event-filter': /AbilityRequestContext/,
  token: /@CurrentUser\(\)/,
};

// ── Fields and variables of conditional rules ────────────────────────────────

const USER = {
  userId: '00000000-0000-7000-8000-000000000001',
  membershipId: '00000000-0000-7000-8000-000000000002',
  tenantId: '00000000-0000-7000-8000-000000000003',
  assignedSections: ['00000000-0000-7000-8000-000000000004'],
  assignedSubjects: ['00000000-0000-7000-8000-000000000005'],
  assignedDepartments: ['00000000-0000-7000-8000-000000000006'],
  linkedStudentIds: ['00000000-0000-7000-8000-000000000007'],
};

const dialect = new PgDialect();

/** `caslToSqlWhere` answers `false` for a rule on a field its column map lacks. */
const failsClosed = (predicate: SQL | undefined) =>
  predicate !== undefined && /\bfalse\b/.test(dialect.sqlToQuery(predicate).sql);

/**
 * How each subject's conditional rules are evaluated: the real predicate of the module, or the
 * fields of the object its row check builds.
 */
const EVALUATORS: Readonly<
  Record<
    string,
    | { predicate: (ability: AppAbility, action: AppAction) => SQL | undefined }
    | { fields: string[] }
  >
> = {
  Student: { predicate: (ability) => studentReadPredicate(ability, null) },
  Guardian: { predicate: (ability) => guardianLinkedReadPredicate(ability, true) },
  Attendance: { predicate: (ability, action) => sectionInScope(ability, action, sectionsLive.id) },
  Leave: {
    predicate: (ability, action) =>
      action === 'create'
        ? mayApplyFor(ability, USER.membershipId)
        : leaveInScope(ability, action, leavesLive.id),
  },
  ReportCard: {
    predicate: (ability) => reportCardInstanceInScope(ability, reportCardInstancesLive.id),
  },
  // `ConsentService.consentStatusForStudent` checks `subject('Consent', { studentProfileId })`.
  Consent: { fields: ['studentProfileId'] },
};

/** Subjects whose conditional rules no institute operation is guarded by; see the test below. */
const NOT_GUARDED_IN_INSTITUTE_SCOPE = new Set(['User']);

/** Actions an operation can check for a rule: `manage` stands for each of them. */
const actionsOf = (rule: AbilityRule, used: GuardedOperation[]): string[] =>
  rule.action === 'manage'
    ? [...new Set(used.filter((o) => o.subject === rule.subject).map((o) => o.action))]
    : [String(rule.action)];

/** What stops a conditional rule from being evaluated; empty when nothing does. */
function unevaluated(rule: AbilityRule, ability: AppAbility, used: GuardedOperation[]): string[] {
  const evaluator = EVALUATORS[String(rule.subject)];
  if (!evaluator) return [`no evaluator for ${String(rule.subject)}`];
  if ('fields' in evaluator) {
    const unknown = Object.keys(rule.conditions ?? {}).filter((f) => !evaluator.fields.includes(f));
    return unknown.length > 0 ? [`fields ${unknown} are never supplied`] : [];
  }
  return actionsOf(rule, used)
    .filter((action) => failsClosed(evaluator.predicate(ability, action as AppAction)))
    .map((action) => `the predicate for '${action}' has no column for a field`);
}

describe('row conditions of guarded operations', () => {
  const all = guardedOperations();
  const institute = all.filter(
    (o) => !o.file.split('/').some((part) => OTHER_SCOPE_DIRS.includes(part)),
  );
  const scoped = all.filter((o) => o.scoped);

  it('should read the guarded operations from the resolver sources', () => {
    // A pattern that stops matching must fail, not pass with nothing to check.
    expect(all.length).toBeGreaterThan(300);
    expect(scoped.length).toBeGreaterThan(40);
  });

  it('should declare row scoping on every institute operation a default role reaches only with a condition', () => {
    const missing = institute
      .filter((o) => !o.scoped && !(o.name in ROW_SCOPE_UNDECLARED))
      .map((o) => ({ o, roles: rolesWithConditionOnly(o.action, o.subject) }))
      .filter(({ roles }) => roles.length > 0)
      .map(({ o, roles }) => `${o.name} (${o.file}): ${o.action} ${o.subject} for ${roles}`);
    expect(missing).toEqual([]);
  });

  it('should list as undeclared only operations that exist and declare nothing, each with a reason', () => {
    const broken = Object.entries(ROW_SCOPE_UNDECLARED)
      .filter(
        ([name, reason]) =>
          reason.trim().length < 20 || !institute.some((o) => o.name === name && !o.scoped),
      )
      .map(([name]) => name);
    expect(broken).toEqual([]);
  });

  it('should have a registry entry for every operation that declares row scoping, and no other', () => {
    const declared = scoped.map((o) => o.name).sort();
    expect(Object.keys(ROW_SCOPE_COVERAGE).sort()).toEqual(declared);
  });

  it('should point every declared operation at an existing spec that names it', () => {
    const broken: string[] = [];
    for (const [name, coverage] of Object.entries(ROW_SCOPE_COVERAGE)) {
      const file = join(ROOT, coverage.spec);
      if (!existsSync(file)) broken.push(`${name}: ${coverage.spec} does not exist`);
      else if (!new RegExp(`\\b${name}\\b`).test(readFileSync(file, 'utf8'))) {
        broken.push(`${name}: ${coverage.spec} never names the operation`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("should hand every declared handler the caller's ability, or the token it reads its rows by", () => {
    const broken = scoped
      .filter((o) => {
        const coverage = ROW_SCOPE_COVERAGE[o.name];
        return coverage !== undefined && !HANDLER_RECEIVES[coverage.how].test(o.source);
      })
      .map((o) => `${o.name} (${o.file}): declared '${ROW_SCOPE_COVERAGE[o.name]?.how}'`);
    expect(broken).toEqual([]);
  });

  it('should supply every $user variable a default rule compares with', () => {
    const unresolved: string[] = [];
    for (const [role, rules] of Object.entries(DEFAULT_ROLE_ABILITIES)) {
      for (const rule of rules) {
        if (!rule.conditions) continue;
        const resolved = JSON.stringify(substituteUserVars(rule.conditions, USER));
        if (/\$user\.|\$\{user\./.test(resolved)) {
          unresolved.push(`${role}: ${String(rule.action)} ${String(rule.subject)} ${resolved}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('should be able to evaluate every field of a conditional default rule', () => {
    const broken = Object.entries(DEFAULT_ROLE_ABILITIES).flatMap(([role, rules]) => {
      const ability = createMongoAbility<AppAbility>(
        rules.map((rule) =>
          rule.conditions
            ? { ...rule, conditions: substituteUserVars(rule.conditions, USER) }
            : rule,
        ),
      );
      return rules
        .filter((rule) => rule.conditions && !rule.inverted)
        .filter((rule) => !NOT_GUARDED_IN_INSTITUTE_SCOPE.has(String(rule.subject)))
        .flatMap((rule) =>
          unevaluated(rule, ability, institute).map(
            (problem) => `${role}: ${String(rule.action)} ${String(rule.subject)}: ${problem}`,
          ),
        );
    });
    expect(broken).toEqual([]);
  });

  it('should have no institute operation guarded by a pair whose conditional rules have no evaluator', () => {
    const guarded = institute
      .filter(
        (o) =>
          NOT_GUARDED_IN_INSTITUTE_SCOPE.has(o.subject) &&
          rolesWithConditionOnly(o.action, o.subject).length > 0,
      )
      .map((o) => `${o.name} (${o.file})`);
    expect(guarded).toEqual([]);
  });
});
