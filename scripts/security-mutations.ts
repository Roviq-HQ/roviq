/**
 * Security mutation run: weakens one security rule at a time and requires a test to fail.
 * A rule whose mutation leaves every spec green has no test (docs/testing.md → "Security
 * mutation run").
 *
 *   pnpm test:security-mutations                  every mutation
 *   pnpm test:security-mutations --only rules     one group: policies, keys, rules or code
 *   pnpm test:security-mutations --match students mutations whose name contains the text
 *   pnpm test:security-mutations --list           print the mutations and stop
 *   pnpm test:security-mutations --e2e            also the mutations that need the e2e stack
 *   pnpm test:security-mutations --no-baseline    skip the first, unmutated run
 *   pnpm test:security-mutations --report <file>  also write the report to a file
 *
 * A database mutation never touches `roviq_test` itself. While the run lasts the database is
 * renamed to `roviq_test_original`, and each mutation gets a fresh copy under the name
 * `roviq_test`, which is dropped afterwards. A code mutation is a patch applied to this working
 * tree and taken out again. A run that was killed is undone by the next start, or by
 * `--recover`, which does nothing else.
 */
import 'dotenv/config';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Client } from 'pg';
import {
  CODE_MUTATIONS,
  DATABASE_SPECS,
  FOREIGN_KEY_SPEC,
  MANIFEST_SPEC,
  ROW_POLICY_SPEC,
  RULE_MUTATIONS,
} from './security-mutations/mutations';
import {
  assertInstanceTestDatabase,
  type CodeMutation,
  type DatabaseChange,
  type DatabaseMutation,
  exitCode,
  type Judgement,
  type Mutation,
  type RuleState,
  readReport,
  refusal,
  renderReport,
  runMutations,
  statement,
  type VitestProject,
  type VitestReport,
} from './security-mutations/plan';

const ROOT = process.cwd();
const PATCHES = join(ROOT, 'scripts/security-mutations/patches');
const WORK = join(ROOT, 'node_modules/.cache/roviq-security-mutations');
const STATE_FILE = join(WORK, 'in-flight.json');
const REPORT_FILE = join(WORK, 'vitest-report.json');

/** The roles whose row policies are opened one at a time. */
const POLICY_ROLES = ['roviq_app', 'roviq_reseller', 'roviq_user'];

const flag = (name: string): boolean => process.argv.includes(name);
function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const say = (text: string): void => {
  process.stdout.write(`[security-mutations] ${text}\n`);
};

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const databaseUrl = assertInstanceTestDatabase(
  process.env.DATABASE_URL_TEST_MIGRATE,
  process.env.DEV_POSTGRES_PORT,
);

const TEST = 'roviq_test';
/** The name `roviq_test` carries while a run works in copies of it. */
const ORIGINAL = 'roviq_test_original';

async function connected<T>(database: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const url = new URL(databaseUrl.toString());
  url.pathname = `/${database}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The maintenance database: renaming, copying and dropping are done from outside. */
const asServer = <T>(fn: (client: Client) => Promise<T>): Promise<T> => connected('postgres', fn);
const inCopy = <T>(fn: (client: Client) => Promise<T>): Promise<T> => connected(TEST, fn);

async function exists(client: Client, database: string): Promise<boolean> {
  const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  return found.rowCount === 1;
}

/** `roviq_test` steps aside; from here on that name is a copy. */
async function setOriginalAside(): Promise<void> {
  await asServer(async (client) => {
    try {
      await client.query(`ALTER DATABASE ${TEST} RENAME TO ${ORIGINAL}`);
    } catch (error) {
      throw new Error(
        `Could not set ${TEST} aside (${(error as Error).message}). Something is connected to it: ` +
          'an integration run or a push gate from this checkout. Try again when it has ended.',
      );
    }
  });
}

async function freshCopy(): Promise<void> {
  await asServer(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${TEST} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${TEST} TEMPLATE ${ORIGINAL}`);
  });
}

/** Drops the copy and gives `roviq_test` its name back. Safe to call at any point of a run. */
async function putOriginalBack(): Promise<boolean> {
  return asServer(async (client) => {
    if (!(await exists(client, ORIGINAL))) return false;
    await client.query(`DROP DATABASE IF EXISTS ${TEST} WITH (FORCE)`);
    await client.query(`ALTER DATABASE ${ORIGINAL} RENAME TO ${TEST}`);
    return true;
  });
}

async function readState(client: Client, change: DatabaseChange): Promise<RuleState | undefined> {
  switch (change.kind) {
    case 'policy-open': {
      const { rows } = await client.query<{ qual: string | null; with_check: string | null }>(
        `SELECT qual, with_check FROM pg_policies
          WHERE schemaname = 'public' AND tablename = $1 AND policyname = $2`,
        [change.table, change.policy],
      );
      if (rows.length === 0) return undefined;
      return { expression: change.part === 'using' ? rows[0].qual : rows[0].with_check };
    }
    case 'trigger-off': {
      const { rows } = await client.query<{ tgenabled: string }>(
        `SELECT t.tgenabled FROM pg_trigger t
          WHERE t.tgrelid = to_regclass(format('public.%I', $1::text)) AND t.tgname = $2`,
        [change.table, change.trigger],
      );
      return rows.length === 0 ? undefined : { enabled: rows[0].tgenabled };
    }
    case 'constraint-drop': {
      const found = await client.query(
        `SELECT 1 FROM pg_constraint o
          WHERE o.conrelid = to_regclass(format('public.%I', $1::text)) AND o.conname = $2`,
        [change.table, change.constraint],
      );
      return { exists: found.rowCount === 1 };
    }
    case 'grant': {
      const { rows } = await client.query<{ held: boolean }>(
        change.columns
          ? `SELECT bool_and(has_column_privilege($1, format('public.%I', $2::text), col, $3)) AS held
               FROM unnest($4::text[]) AS col`
          : `SELECT has_table_privilege($1, format('public.%I', $2::text), $3) AS held`,
        change.columns
          ? [change.role, change.table, change.privilege, change.columns]
          : [change.role, change.table, change.privilege],
      );
      return { held: rows[0].held };
    }
  }
}

/**
 * Two mutations at most per row policy of the three roles: its USING expression passes every
 * row, and its WITH CHECK expression does.
 */
async function policyMutations(client: Client): Promise<DatabaseMutation[]> {
  const { rows } = await client.query<{
    tablename: string;
    policyname: string;
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `SELECT p.tablename::text, p.policyname::text, p.cmd, p.qual, p.with_check
       FROM pg_policies p
       JOIN pg_class c ON c.relname = p.tablename
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE p.schemaname = 'public' AND p.roles::text[] && $1 AND NOT c.relispartition
      ORDER BY 1, 2`,
    [POLICY_ROLES],
  );
  const open = (row: (typeof rows)[number], part: 'using' | 'check'): DatabaseMutation => ({
    type: 'database',
    name: `${row.cmd} policy ${row.policyname}: ${part === 'using' ? 'USING' : 'WITH CHECK'} passes every row`,
    group: 'policies',
    changes: [{ kind: 'policy-open', table: row.tablename, policy: row.policyname, part }],
    specs: [ROW_POLICY_SPEC],
    thenWholeProject: true,
  });
  return rows.flatMap((row) => [
    ...(row.qual !== null && row.qual !== 'true' ? [open(row, 'using')] : []),
    ...(row.with_check !== null && row.with_check !== 'true' ? [open(row, 'check')] : []),
  ]);
}

/** One mutation per foreign key that carries `tenant_id`: the key is dropped. */
async function keyMutations(client: Client): Promise<DatabaseMutation[]> {
  const { rows } = await client.query<{ relname: string; conname: string }>(
    `SELECT c.relname, o.conname
       FROM pg_constraint o
       JOIN pg_class c ON c.oid = o.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND o.contype = 'f' AND array_length(o.conkey, 1) > 1
        AND NOT c.relispartition
        AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = o.conrelid AND a.attnum = ANY (o.conkey)
                       AND a.attname = 'tenant_id')
      ORDER BY 1, 2`,
  );
  return rows.map((row) => ({
    type: 'database',
    name: `foreign key ${row.conname} dropped`,
    group: 'keys',
    changes: [{ kind: 'constraint-drop', table: row.relname, constraint: row.conname }],
    specs: [FOREIGN_KEY_SPEC],
    thenWholeProject: false,
  }));
}

// ---------------------------------------------------------------------------
// A patch in flight, and recovery
// ---------------------------------------------------------------------------

function remember(patch: string): void {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ patch }));
}

const forget = (): void => rmSync(STATE_FILE, { force: true });

function git(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
}

const patchFile = (name: string): string => join(PATCHES, `${name}.patch`);

/** Takes out the patch a run was holding, if any. */
function takePatchOut(): boolean {
  if (!existsSync(STATE_FILE)) return false;
  const { patch } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { patch: string };
  // The patch may or may not have reached the tree before the run died.
  if (git(['apply', '--reverse', '--check', patchFile(patch)]).ok) {
    const undone = git(['apply', '--reverse', patchFile(patch)]);
    if (!undone.ok) throw new Error(`Could not take patch ${patch} out:\n${undone.output}`);
  }
  forget();
  return true;
}

/** Undo whatever a killed run left behind. Returns true when there was something to undo. */
async function recover(): Promise<boolean> {
  const patch = takePatchOut();
  if (patch) say('recovered: the patch in flight is out of the working tree');
  const database = await putOriginalBack();
  if (database) say(`recovered: ${TEST} is the original database again`);
  return patch || database;
}

// ---------------------------------------------------------------------------
// Running specs
// ---------------------------------------------------------------------------

let running: ChildProcess | null = null;

/** Runs Vitest and returns the first spec file with a failed test, or null when all passed. */
async function runSpecs(
  project: VitestProject,
  specs: string[],
  exclude: string[],
): Promise<string | null> {
  rmSync(REPORT_FILE, { force: true });
  const env: NodeJS.ProcessEnv = { ...process.env, INTEGRATION_EXCLUDE: exclude.join(' ') };
  // Nx reads this variable and would run the main checkout's files.
  delete env.NX_WORKSPACE_ROOT_PATH;
  if (project === 'e2e-api') {
    // The e2e specs read rows from the e2e stack's own database, which they find by its port
    // when these are unset. This script loaded them from .env for the integration database.
    delete env.DATABASE_URL_TEST_MIGRATE;
    delete env.DATABASE_URL_TEST;
  }
  const args = [
    'vitest',
    'run',
    '--project',
    project,
    ...specs,
    '--bail=1',
    '--reporter=json',
    `--outputFile=${REPORT_FILE}`,
  ];
  const output: Buffer[] = [];
  const status = await new Promise<number | null>((done) => {
    const child = spawn('pnpm', args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    running = child;
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk));
    child.on('close', (code) => {
      running = null;
      done(code);
    });
  });
  const tail = () => Buffer.concat(output).toString('utf8').split('\n').slice(-40).join('\n');
  if (!existsSync(REPORT_FILE)) {
    throw new Error(`Vitest wrote no report (exit ${status}); its last lines:\n${tail()}`);
  }
  const report = readReport(JSON.parse(readFileSync(REPORT_FILE, 'utf8')) as VitestReport);
  if (report.ran === 0) {
    throw new Error(`No test ran for ${specs.join(', ') || project}; its last lines:\n${tail()}`);
  }
  if (report.failed === 0 && status !== 0) {
    throw new Error(
      `Vitest failed without a failed test (exit ${status}): a file did not load.\n${tail()}`,
    );
  }
  return report.firstFailedFile ? relative(ROOT, report.firstFailedFile) : null;
}

/** The specs of a database mutation never include the manifest comparison unless it names it. */
function excludeFor(mutation: DatabaseMutation): string[] {
  return mutation.specs.includes(MANIFEST_SPEC) ? [] : [`**/${MANIFEST_SPEC.split('/').pop()}`];
}

/**
 * The whole project runs its files side by side, and a few of them fail now and then for
 * reasons of their own. A failure there counts only when the same file fails again, alone,
 * in a fresh copy with the same mutation.
 */
async function judge(mutation: Mutation): Promise<Judgement> {
  if (mutation.type === 'code') {
    return { noticedBy: await runSpecs(mutation.project, mutation.specs, []) };
  }
  const exclude = excludeFor(mutation);
  const first = mutation.specs.length > 0 ? mutation.specs : [DATABASE_SPECS];
  const failed = await runSpecs('integration', first, exclude);
  if (failed !== null || !mutation.thenWholeProject) return { noticedBy: failed };
  const inWholeRun = await runSpecs('integration', [], exclude);
  if (inWholeRun === null) return { noticedBy: null };
  await freshCopy();
  const refused = await applyDatabase(mutation);
  if (refused !== null) throw new Error(`${mutation.name}: ${refused}`);
  const alone = await runSpecs('integration', [inWholeRun], exclude);
  if (alone !== null) return { noticedBy: alone };
  return {
    noticedBy: null,
    note: `${inWholeRun} failed once in the whole run and passed alone: not a proof`,
  };
}

// ---------------------------------------------------------------------------
// Applying and restoring
// ---------------------------------------------------------------------------

async function applyDatabase(mutation: DatabaseMutation): Promise<string | null> {
  return inCopy(async (client) => {
    const planned: string[] = [];
    for (const change of mutation.changes) {
      const refused = refusal(change, await readState(client, change));
      if (refused !== null) return refused;
      planned.push(statement(change));
    }
    try {
      await client.query('BEGIN');
      for (const text of planned) await client.query(text);
      await client.query('COMMIT');
    } catch (error) {
      return `could not be applied: ${(error as Error).message}`;
    }
    return null;
  });
}

function applyCode(mutation: CodeMutation): string | null {
  const file = patchFile(mutation.patch);
  if (!existsSync(file)) return `no patch file ${relative(ROOT, file)}`;
  const check = git(['apply', '--check', file]);
  if (!check.ok) return `the patch no longer applies: ${check.output.split('\n')[0]}`;
  remember(mutation.patch);
  const applied = git(['apply', file]);
  if (!applied.ok) {
    forget();
    return `the patch could not be applied: ${applied.output.split('\n')[0]}`;
  }
  return null;
}

let stopping = false;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** A push gate started from this checkout uses the same `roviq_test`; another slot's does not. */
function gateIsRunningHere(): boolean {
  const result = spawnSync('bash', ['scripts/ci-queue.sh'], { cwd: ROOT, encoding: 'utf8' });
  const slot = /^busy: slot (\d+),/.exec(result.stdout)?.[1];
  return slot !== undefined && slot === (process.env.ROVIQ_INSTANCE ?? '0');
}

async function baseline(mutations: Mutation[]): Promise<void> {
  const failures: string[] = [];
  const check = async (project: VitestProject, specs: string[]) => {
    const failed = await runSpecs(project, specs, []);
    if (failed === null) return;
    // A file that fails beside the others and passes alone does not stop the run: a failure
    // of the whole project is confirmed alone before it counts (see `judge`).
    if (project === 'integration') await freshCopy();
    if ((await runSpecs(project, [failed], [])) === null) {
      say(`baseline: ${failed} failed beside the other files and passed alone`);
      return;
    }
    failures.push(failed);
  };
  if (mutations.some((m) => m.type === 'database' && m.thenWholeProject)) {
    say('baseline: the whole integration project, nothing weakened');
    await check('integration', []);
  }
  for (const project of ['integration', 'unit-node', 'e2e-api'] as const) {
    const specs = [
      ...new Set(
        mutations
          .filter((m) => (m.type === 'code' ? m.project : 'integration') === project)
          .flatMap((m) => m.specs),
      ),
    ];
    if (specs.length === 0) continue;
    say(`baseline: ${specs.length} named ${project} spec(s), nothing weakened`);
    await check(project, specs);
  }
  if (failures.length > 0) {
    throw new Error(
      `A spec fails before anything is weakened, so a failure would prove nothing: ${failures.join(', ')}`,
    );
  }
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production');
  if (await recover()) {
    if (flag('--recover')) return 0;
  } else if (flag('--recover')) {
    say('nothing to recover');
    return 0;
  }

  const discovered = await connected(TEST, async (client) => [
    ...(await policyMutations(client)),
    ...(await keyMutations(client)),
  ]);
  const only = option('--only');
  const match = option('--match');
  const mutations = [...discovered, ...RULE_MUTATIONS, ...CODE_MUTATIONS]
    .filter((m) => !only || m.group === only)
    .filter((m) => !match || m.name.includes(match))
    .filter((m) => flag('--e2e') || m.type !== 'code' || m.project !== 'e2e-api');

  if (flag('--list')) {
    for (const m of mutations) process.stdout.write(`${m.group}\t${m.name}\n`);
    return 0;
  }
  if (mutations.length === 0) throw new Error('No mutation matches');
  if (gateIsRunningHere()) {
    throw new Error('A push gate is running from this checkout and uses roviq_test: try later');
  }

  // Tracked files only: a patch never adds a file, and a report may be written into the tree.
  const treeBefore = git(['diff']).output;

  const stop = (signal: NodeJS.Signals) => {
    say(`${signal}: stopping and putting everything back`);
    stopping = true;
    running?.kill('SIGTERM');
    const done = running
      ? new Promise<void>((resolve) => running?.once('close', () => resolve()))
      : Promise.resolve();
    done
      .then(recover)
      .catch((error: Error) => say(`recover failed: ${error.message}`))
      .finally(() => process.exit(130));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  await setOriginalAside();
  let outcomes: Awaited<ReturnType<typeof runMutations>>;
  try {
    if (!flag('--no-baseline')) {
      await freshCopy();
      await baseline(mutations);
    }
    outcomes = await runMutations(mutations, {
      apply: async (mutation) => {
        say(`${mutation.group}: ${mutation.name}`);
        // Every mutation starts from the database as the run found it.
        await freshCopy();
        return mutation.type === 'code' ? applyCode(mutation) : applyDatabase(mutation);
      },
      restore: async () => {
        // A signal handler is putting everything back and exits when it is done.
        if (stopping) return new Promise<void>(() => {});
        takePatchOut();
      },
      judge,
      now: () => Date.now(),
    });
  } finally {
    if (!stopping) {
      takePatchOut();
      await putOriginalBack();
    }
  }

  const report = renderReport(outcomes);
  process.stdout.write(`\n${report}`);
  const reportPath = option('--report');
  if (reportPath) writeFileSync(reportPath, report);

  if (git(['diff']).output !== treeBefore) {
    throw new Error('The working tree differs from how the run found it: read `git diff`');
  }
  return exitCode(outcomes);
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    process.stderr.write(`[security-mutations] ${error.message}\n`);
    process.exit(2);
  });
