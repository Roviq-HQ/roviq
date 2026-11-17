// Parallel dev instances: one git worktree per agent, each with its own ports and
// Docker Compose projects. See docs/infrastructure.md → "Parallel dev instances".
//
//   pnpm instance:new <slot> <branch> [path]   create a worktree and configure it
//   pnpm instance:env <slot>                    re-target this checkout's .env
//   pnpm instance:ports [slot]                  print the port table and what is in use
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import {
  assertSlot,
  composeProjectsForSlot,
  type InstancePorts,
  MAX_SLOT,
  PORT_VARS,
  type PortVar,
  portsForSlot,
  rewriteEnvForSlot,
  slotFromEnv,
} from './lib/instance';

const USAGE = `Usage:
  pnpm instance:new <slot 1-${MAX_SLOT}> <branch> [path]   (path defaults to ../roviq-<slot>)
  pnpm instance:env <slot 0-${MAX_SLOT}>
  pnpm instance:ports [slot]`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function parseSlot(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw)) fail(USAGE);
  const slot = Number(raw);
  assertSlot(slot);
  return slot;
}

function run(command: string, args: string[], cwd: string, env = process.env): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed (exit ${result.status ?? 'signal'})`);
  }
}

function isFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.once('listening', () => server.close(() => done(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function busyPorts(ports: InstancePorts): Promise<PortVar[]> {
  const busy: PortVar[] = [];
  for (const name of PORT_VARS) {
    if (!(await isFree(ports[name]))) busy.push(name);
  }
  return busy;
}

function writeEnv(checkout: string, sourceEnv: string, slot: number): void {
  writeFileSync(join(checkout, '.env'), rewriteEnvForSlot(readFileSync(sourceEnv, 'utf8'), slot));
}

/** Claude Code sessions in the checkout get TILT_PORT, so plain `tilt trigger` reaches this instance. */
function writeClaudeSettings(checkout: string, sourceCheckout: string, tiltPort: number): void {
  const target = join(checkout, '.claude', 'settings.local.json');
  const source = join(sourceCheckout, '.claude', 'settings.local.json');
  const existing = existsSync(target) ? target : existsSync(source) ? source : undefined;
  const parsed: unknown = existing ? JSON.parse(readFileSync(existing, 'utf8')) : {};
  const settings: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {};
  const env =
    typeof settings.env === 'object' && settings.env !== null && !Array.isArray(settings.env)
      ? { ...settings.env }
      : {};
  settings.env = { ...env, TILT_PORT: String(tiltPort) };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`);
}

function printSummary(checkout: string, slot: number): void {
  const ports = portsForSlot(slot);
  const projects = composeProjectsForSlot(slot);
  log(`
Instance ${slot} is configured in ${checkout}

  Web        http://localhost:${ports.WEB_PORT}  (admin.localhost / reseller.localhost on the same port)
  API        http://localhost:${ports.API_GATEWAY_PORT}/api/graphql
  PostgreSQL localhost:${ports.DEV_POSTGRES_PORT}
  Tilt UI    http://localhost:${ports.TILT_PORT}
  Compose    ${projects.dev} (dev), ${projects.e2e} (e2e)

Start it:
  cd ${checkout} && pnpm tilt up

In that checkout, run Tilt through "pnpm tilt <args>" (or export TILT_PORT=${ports.TILT_PORT}).
Claude Code sessions opened there already have TILT_PORT set.
Use a separate browser profile per instance: cookies on localhost are shared across ports.`);
}

async function warnBusy(slot: number): Promise<void> {
  const ports = portsForSlot(slot);
  const busy = await busyPorts(ports);
  if (busy.length > 0) {
    log(
      `\nPorts already in use (expected if instance ${slot} is running):\n${busy
        .map((name) => `  ${name}=${ports[name]}`)
        .join('\n')}`,
    );
  }
}

async function commandNew(args: string[]): Promise<void> {
  const slot = parseSlot(args[0]);
  const branch = args[1];
  if (slot === 0 || !branch) fail(USAGE);

  const source = process.cwd();
  const checkout = resolve(source, args[2] ?? `../roviq-${slot}`);
  if (existsSync(checkout)) fail(`${checkout} already exists`);

  const branchExists =
    spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: source })
      .status === 0;
  run('git', ['worktree', 'add', checkout, ...(branchExists ? [branch] : ['-b', branch])], source);

  const sourceEnv = existsSync(join(source, '.env'))
    ? join(source, '.env')
    : join(source, '.env.example');
  writeEnv(checkout, sourceEnv, slot);
  writeClaudeSettings(checkout, source, portsForSlot(slot).TILT_PORT);

  // Nx resolves the workspace from this variable when set, which would point at the source checkout.
  const { NX_WORKSPACE_ROOT_PATH: _ignored, ...env } = process.env;
  run('pnpm', ['install', '--frozen-lockfile'], checkout, env);

  printSummary(checkout, slot);
  await warnBusy(slot);
}

async function commandEnv(args: string[]): Promise<void> {
  const slot = parseSlot(args[0]);
  const checkout = process.cwd();
  const envPath = join(checkout, '.env');
  if (!existsSync(envPath)) copyFileSync(join(checkout, '.env.example'), envPath);

  writeEnv(checkout, envPath, slot);
  if (slot > 0) writeClaudeSettings(checkout, checkout, portsForSlot(slot).TILT_PORT);
  printSummary(checkout, slot);
  await warnBusy(slot);
}

async function commandPorts(args: string[]): Promise<void> {
  const envPath = join(process.cwd(), '.env');
  const slot =
    args[0] !== undefined
      ? parseSlot(args[0])
      : existsSync(envPath)
        ? slotFromEnv(readFileSync(envPath, 'utf8'))
        : 0;
  const ports = portsForSlot(slot);
  const busy = new Set(await busyPorts(ports));

  log(`Instance ${slot}`);
  for (const name of PORT_VARS) {
    log(
      `  ${name.padEnd(28)} ${String(ports[name]).padEnd(6)} ${busy.has(name) ? 'in use' : 'free'}`,
    );
  }
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void>> = {
  new: commandNew,
  env: commandEnv,
  ports: commandPorts,
};
const handler = command ? commands[command] : undefined;
if (!handler) fail(USAGE);
handler(rest).catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
