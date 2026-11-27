import { describe, expect, it } from 'vitest';
import {
  assertInstanceTestDatabase,
  type CodeMutation,
  type DatabaseMutation,
  exitCode,
  type Mutation,
  type Outcome,
  type RunSteps,
  readReport,
  refusal,
  renderReport,
  runMutations,
  statement,
} from '../security-mutations/plan';

const table: DatabaseMutation = {
  type: 'database',
  name: 'SELECT policy student_profiles_app_select: USING passes every row',
  group: 'policies',
  changes: [
    {
      kind: 'policy-open',
      table: 'student_profiles',
      policy: 'student_profiles_app_select',
      part: 'using',
    },
  ],
  specs: [],
  thenWholeProject: true,
};
const patch: CodeMutation = {
  type: 'code',
  name: 'ability-guard-row-scope',
  patch: 'ability-guard-row-scope',
  group: 'code',
  project: 'unit-node',
  specs: ['libs/backend/casl/src/__tests__/ability.guard.spec.ts'],
};

function steps(over: Partial<RunSteps>, log: string[] = []): RunSteps {
  let clock = 0;
  return {
    apply: async (m) => {
      log.push(`apply ${m.name}`);
      return null;
    },
    restore: async (m) => {
      log.push(`restore ${m.name}`);
    },
    judge: async () => ({ noticedBy: 'some.spec.ts' }),
    now: () => {
      clock += 2000;
      return clock;
    },
    ...over,
  };
}

describe('assertInstanceTestDatabase', () => {
  const ok = 'postgresql://roviq:x@localhost:5454/roviq_test';

  it('should accept roviq_test on this instance’s own port', () => {
    expect(assertInstanceTestDatabase(ok, '5454').port).toBe('5454');
  });

  it.each([
    ['the dev database', 'postgresql://roviq:x@localhost:5454/roviq', /Refusing database "roviq"/],
    ['another host', 'postgresql://roviq:x@db.example.com:5454/roviq_test', /Refusing host/],
    ['another instance’s port', 'postgresql://roviq:x@localhost:5474/roviq_test', /Refusing port/],
    ['a URL with no port', 'postgresql://roviq:x@localhost/roviq_test', /Refusing port/],
  ])('should refuse %s', (_what, url, message) => {
    expect(() => assertInstanceTestDatabase(url, '5454')).toThrow(message);
  });

  it('should refuse when either variable is missing', () => {
    expect(() => assertInstanceTestDatabase(undefined, '5454')).toThrow(/not set/);
    expect(() => assertInstanceTestDatabase(ok, undefined)).toThrow(/DEV_POSTGRES_PORT/);
  });
});

describe('statement', () => {
  it('should open the USING or the WITH CHECK expression of a policy', () => {
    expect(
      statement({
        kind: 'policy-open',
        table: 'student_profiles',
        policy: 'student_profiles_app_select',
        part: 'using',
      }),
    ).toBe('ALTER POLICY "student_profiles_app_select" ON public."student_profiles" USING (true)');
    expect(
      statement({
        kind: 'policy-open',
        table: 'memberships',
        policy: 'memberships_app_insert',
        part: 'check',
      }),
    ).toBe('ALTER POLICY "memberships_app_insert" ON public."memberships" WITH CHECK (true)');
  });

  it('should disable a trigger and drop a constraint by name', () => {
    expect(
      statement({ kind: 'trigger-off', table: 'users', trigger: 'users_keep_origin_tenant' }),
    ).toBe('ALTER TABLE public."users" DISABLE TRIGGER "users_keep_origin_tenant"');
    expect(
      statement({
        kind: 'constraint-drop',
        table: 'sections',
        constraint: 'sections_standard_id_tenant_fkey',
      }),
    ).toBe('ALTER TABLE public."sections" DROP CONSTRAINT "sections_standard_id_tenant_fkey"');
  });

  it('should grant a table privilege, or a column privilege when columns are named', () => {
    expect(
      statement({
        kind: 'grant',
        privilege: 'DELETE',
        table: 'student_profiles',
        role: 'roviq_app',
      }),
    ).toBe('GRANT DELETE ON public."student_profiles" TO "roviq_app"');
    expect(
      statement({
        kind: 'grant',
        privilege: 'UPDATE',
        table: 'institutes',
        role: 'roviq_app',
        columns: ['code'],
      }),
    ).toBe('GRANT UPDATE ("code") ON public."institutes" TO "roviq_app"');
  });

  it('should quote a name that holds a quote', () => {
    expect(statement({ kind: 'trigger-off', table: 't', trigger: 'a"b' })).toContain('"a""b"');
  });
});

describe('refusal', () => {
  it('should refuse a rule that is gone or already weak', () => {
    const policy = { kind: 'policy-open', table: 't', policy: 'p', part: 'using' } as const;
    expect(refusal(policy, undefined)).toMatch(/does not exist/);
    expect(refusal(policy, { expression: 'true' })).toMatch(/already passes every row/);
    expect(refusal(policy, { expression: null })).toMatch(/no using expression/);
    expect(refusal({ kind: 'trigger-off', table: 't', trigger: 'g' }, { enabled: 'D' })).toMatch(
      /already disabled/,
    );
    expect(
      refusal({ kind: 'constraint-drop', table: 't', constraint: 'c' }, { exists: false }),
    ).toMatch(/does not exist/);
    // A privilege already held could not be told from the mutation, and would be revoked after.
    expect(
      refusal(
        { kind: 'grant', privilege: 'SELECT', table: 't', role: 'roviq_app' },
        { held: true },
      ),
    ).toMatch(/already holds/);
  });

  it('should accept a rule that is in force', () => {
    expect(
      refusal(
        { kind: 'policy-open', table: 't', policy: 'p', part: 'using' },
        { expression: 'x = 1' },
      ),
    ).toBeNull();
    expect(
      refusal({ kind: 'grant', privilege: 'SELECT', table: 't', role: 'r' }, { held: false }),
    ).toBeNull();
  });
});

describe('readReport', () => {
  it('should name the first file with a failed test', () => {
    expect(
      readReport({
        numTotalTests: 3,
        numFailedTests: 1,
        testResults: [
          { name: '/repo/a.spec.ts', status: 'passed', assertionResults: [{ status: 'passed' }] },
          {
            name: '/repo/b.spec.ts',
            status: 'failed',
            assertionResults: [{ status: 'passed' }, { status: 'failed' }],
          },
        ],
      }),
    ).toEqual({ ran: 3, failed: 1, firstFailedFile: '/repo/b.spec.ts' });
  });

  it('should not count a file that failed to load as a failed test', () => {
    expect(
      readReport({
        numTotalTests: 0,
        numFailedTests: 0,
        testResults: [{ name: '/repo/a.spec.ts', status: 'failed', assertionResults: [] }],
      }),
    ).toEqual({ ran: 0, failed: 0, firstFailedFile: null });
  });
});

describe('runMutations', () => {
  it('should report a mutation whose specs all pass as not noticed, and fail the run', async () => {
    const outcomes = await runMutations(
      [table, patch],
      steps({ judge: async (m) => ({ noticedBy: m === patch ? 'x.spec.ts' : null }) }),
    );
    expect(outcomes.map((o) => [o.name, o.verdict])).toEqual([
      [table.name, 'not noticed'],
      [patch.name, 'noticed'],
    ]);
    expect(exitCode(outcomes)).toBe(1);
  });

  it('should not count a failure the caller could not repeat, and say so in the report', async () => {
    const outcomes = await runMutations(
      [table],
      steps({
        judge: async () => ({ noticedBy: null, note: 'a.spec.ts failed once, then passed' }),
      }),
    );
    expect(outcomes).toEqual([
      expect.objectContaining({
        verdict: 'not noticed',
        detail: 'a.spec.ts failed once, then passed',
      }),
    ]);
  });

  it('should pass only when every mutation was noticed', async () => {
    const outcomes = await runMutations([table, patch], steps({}));
    expect(outcomes.every((o) => o.verdict === 'noticed' && o.seconds === 2)).toBe(true);
    expect(exitCode(outcomes)).toBe(0);
  });

  it('should put the rule back when the specs could not be run, and stop', async () => {
    const log: string[] = [];
    const failing = steps(
      {
        judge: async () => {
          throw new Error('Vitest wrote no report');
        },
      },
      log,
    );
    await expect(runMutations([table, patch], failing)).rejects.toThrow('Vitest wrote no report');
    expect(log).toEqual([`apply ${table.name}`, `restore ${table.name}`]);
  });

  it('should not judge a mutation that could not be applied, and fail the run', async () => {
    const log: string[] = [];
    const judged: Mutation[] = [];
    const outcomes = await runMutations(
      [patch],
      steps(
        {
          apply: async () => 'the patch no longer applies',
          judge: async (m) => {
            judged.push(m);
            return { noticedBy: 'x.spec.ts' };
          },
        },
        log,
      ),
    );
    expect(outcomes).toEqual([
      expect.objectContaining({ verdict: 'not applied', detail: 'the patch no longer applies' }),
    ]);
    expect(judged).toEqual([]);
    // Restoring is still asked for: a refusal may come after part of the work was done.
    expect(log).toEqual([`restore ${patch.name}`]);
    expect(exitCode(outcomes)).toBe(1);
  });

  it('should restore each mutation before applying the next', async () => {
    const log: string[] = [];
    await runMutations([table, patch], steps({}, log));
    expect(log).toEqual([
      `apply ${table.name}`,
      `restore ${table.name}`,
      `apply ${patch.name}`,
      `restore ${patch.name}`,
    ]);
  });
});

describe('renderReport', () => {
  const outcome = (verdict: Outcome['verdict']): Outcome => ({
    name: 'm',
    group: 'rules',
    verdict,
    detail: 'd',
    seconds: 1,
  });

  it('should count each verdict and say what to do about the open ones', () => {
    const text = renderReport([outcome('noticed'), outcome('not noticed'), outcome('not applied')]);
    expect(text).toContain('3 mutation(s), 1 noticed, 1 not noticed, 1 not applied');
    expect(text).toContain('has no test');
  });

  it('should add no advice when everything was noticed', () => {
    expect(renderReport([outcome('noticed')])).not.toContain('has no test');
  });
});
