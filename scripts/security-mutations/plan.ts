/**
 * The pure parts of the security mutation run (`scripts/security-mutations.ts`): what a
 * mutation is, which database it may touch, how a rule is weakened and put back, and how a
 * run is judged. Nothing here connects to anything.
 */

export type VitestProject = 'integration' | 'unit-node' | 'e2e-api';

/** A rule of the database, weakened in a copy of the test database that is then dropped. */
export type DatabaseChange =
  /** Every row passes the policy's USING (or WITH CHECK) expression. */
  | { kind: 'policy-open'; table: string; policy: string; part: 'using' | 'check' }
  | { kind: 'trigger-off'; table: string; trigger: string }
  | { kind: 'constraint-drop'; table: string; constraint: string }
  /** A privilege the role does not hold today. `columns` makes it a column grant. */
  | { kind: 'grant'; privilege: string; table: string; role: string; columns?: string[] };

export interface DatabaseMutation {
  type: 'database';
  /** Shown in the report. Says which rule is weakened. */
  name: string;
  group: 'policies' | 'keys' | 'rules';
  changes: DatabaseChange[];
  /** Spec files run first. Empty: the database specs. */
  specs: string[];
  /** When the first specs stay green, run the whole integration project before giving up. */
  thenWholeProject: boolean;
}

export interface CodeMutation {
  type: 'code';
  /** Shown in the report. */
  name: string;
  /** File name in `scripts/security-mutations/patches/`, without `.patch`. */
  patch: string;
  group: 'code';
  project: VitestProject;
  specs: string[];
}

export type Mutation = DatabaseMutation | CodeMutation;

export type Verdict =
  /** At least one test failed while the rule was weakened. */
  | 'noticed'
  /** Every test passed: nothing proves this rule. */
  | 'not noticed'
  /** The mutation could not be applied (the rule or the code it names is gone or changed). */
  | 'not applied';

export interface Outcome {
  name: string;
  group: Mutation['group'];
  verdict: Verdict;
  /** The first spec file with a failed test, or why the mutation was not applied. */
  detail: string;
  seconds: number;
}

/** The current state of one rule, read from the catalog before it is weakened. */
export interface RuleState {
  /** `pg_policies.qual` or `with_check` of a `policy-open` change. */
  expression?: string | null;
  /** `pg_trigger.tgenabled` of a `trigger-off` change. */
  enabled?: string;
  /** Whether the constraint of a `constraint-drop` change exists. */
  exists?: boolean;
  /** Whether the role already holds the privilege of a `grant` change. */
  held?: boolean;
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Why a change cannot be applied to the database as it is, or null when it can. */
export function refusal(change: DatabaseChange, state: RuleState | undefined): string | null {
  switch (change.kind) {
    case 'policy-open':
      if (!state) return `policy ${change.policy} on ${change.table} does not exist`;
      if (!state.expression) return `policy ${change.policy} has no ${change.part} expression`;
      if (state.expression === 'true') return `policy ${change.policy} already passes every row`;
      return null;
    case 'trigger-off':
      if (!state) return `trigger ${change.trigger} on ${change.table} does not exist`;
      if (state.enabled === 'D') return `trigger ${change.trigger} is already disabled`;
      return null;
    case 'constraint-drop':
      if (!state?.exists) {
        return `constraint ${change.constraint} on ${change.table} does not exist`;
      }
      return null;
    case 'grant':
      if (state?.held) {
        return `${change.role} already holds ${change.privilege} on ${change.table}`;
      }
      return null;
  }
}

/** The statement that weakens the rule. Nothing puts it back: the copy it ran in is dropped. */
export function statement(change: DatabaseChange): string {
  const table = `public.${ident(change.table)}`;
  switch (change.kind) {
    case 'policy-open': {
      const clause = change.part === 'using' ? 'USING' : 'WITH CHECK';
      return `ALTER POLICY ${ident(change.policy)} ON ${table} ${clause} (true)`;
    }
    case 'trigger-off':
      return `ALTER TABLE ${table} DISABLE TRIGGER ${ident(change.trigger)}`;
    case 'constraint-drop':
      return `ALTER TABLE ${table} DROP CONSTRAINT ${ident(change.constraint)}`;
    case 'grant': {
      const columns = change.columns ? ` (${change.columns.map(ident).join(', ')})` : '';
      return `GRANT ${change.privilege}${columns} ON ${table} TO ${ident(change.role)}`;
    }
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The run sets `roviq_test` aside and works in copies of it, so it accepts one database only:
 * `roviq_test` on this machine, on this instance's own PostgreSQL port. Anything else is refused
 * before a connection opens.
 */
export function assertInstanceTestDatabase(
  url: string | undefined,
  instancePort: string | undefined,
): URL {
  if (!url) throw new Error('DATABASE_URL_TEST_MIGRATE is not set');
  if (!instancePort) throw new Error('DEV_POSTGRES_PORT is not set: which instance is this?');
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, '');
  if (database !== 'roviq_test') {
    throw new Error(`Refusing database "${database}": the run changes rules only in roviq_test`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing host "${parsed.hostname}": the run works on this machine only`);
  }
  if (parsed.port !== instancePort) {
    throw new Error(
      `Refusing port ${parsed.port || '(default)'}: this instance's PostgreSQL is on ${instancePort}`,
    );
  }
  return parsed;
}

/** The fields of Vitest's JSON report the run reads. */
export interface VitestReport {
  numTotalTests: number;
  numFailedTests: number;
  testResults: { name: string; status: string; assertionResults: { status: string }[] }[];
}

/**
 * A mutation is noticed only by a failed test. A file that could not be loaded, or a run that
 * collected nothing, proves nothing and is reported as an error by the caller.
 */
export function readReport(report: VitestReport): {
  ran: number;
  failed: number;
  firstFailedFile: string | null;
} {
  const failedFile = report.testResults.find((file) =>
    file.assertionResults.some((test) => test.status === 'failed'),
  );
  return {
    ran: report.numTotalTests,
    failed: report.numFailedTests,
    firstFailedFile: failedFile?.name ?? null,
  };
}

/** Exit code of a run: 0 only when every mutation was applied and noticed. */
export function exitCode(outcomes: Outcome[]): number {
  return outcomes.every((outcome) => outcome.verdict === 'noticed') ? 0 : 1;
}

export function renderReport(outcomes: Outcome[]): string {
  const count = (verdict: Verdict) => outcomes.filter((o) => o.verdict === verdict).length;
  const lines = [
    `Security mutation run: ${outcomes.length} mutation(s), ${count('noticed')} noticed, ` +
      `${count('not noticed')} not noticed, ${count('not applied')} not applied.`,
    '',
    '| Group | Mutation | Verdict | Seconds | Detail |',
    '| -- | -- | -- | -- | -- |',
    ...outcomes.map(
      (o) => `| ${o.group} | ${o.name} | ${o.verdict} | ${o.seconds} | ${o.detail} |`,
    ),
  ];
  const open = outcomes.filter((o) => o.verdict !== 'noticed');
  if (open.length > 0) {
    lines.push(
      '',
      'A mutation that is not noticed has no test: write one that attempts what the weakened',
      'rule would allow. A mutation that is not applied names a rule or code that changed:',
      'update the list or the patch.',
    );
  }
  return `${lines.join('\n')}\n`;
}

export interface Judgement {
  /** The first spec file with a failed test, or null when nothing failed because of the mutation. */
  noticedBy: string | null;
  /** Shown in the report when nothing noticed the mutation. */
  note?: string;
}

export interface RunSteps {
  /** Weakens the rule. Returns why it could not, or null. */
  apply(mutation: Mutation): Promise<string | null>;
  /** Undoes the mutation. Called after every `apply`, refused or not, also when `judge` throws. */
  restore(mutation: Mutation): Promise<void>;
  /** Runs the specs. */
  judge(mutation: Mutation): Promise<Judgement>;
  now(): number;
}

/** One mutation at a time: weaken, run, put back, record. */
export async function runMutations(mutations: Mutation[], steps: RunSteps): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const mutation of mutations) {
    const started = steps.now();
    const record = (verdict: Verdict, detail: string) =>
      outcomes.push({
        name: mutation.name,
        group: mutation.group,
        verdict,
        detail,
        seconds: Math.round((steps.now() - started) / 1000),
      });
    let refused: string | null = null;
    let judgement: Judgement = { noticedBy: null };
    try {
      refused = await steps.apply(mutation);
      if (refused === null) judgement = await steps.judge(mutation);
    } finally {
      await steps.restore(mutation);
    }
    if (refused !== null) record('not applied', refused);
    else if (judgement.noticedBy !== null) record('noticed', judgement.noticedBy);
    else record('not noticed', judgement.note ?? 'every spec passed');
  }
  return outcomes;
}
