// Checks that the services the integration suite connects to are listening,
// and starts the dev infra containers when they are not (e.g. after a reboot).
// Used by vitest.integration.global-setup.ts and, up front, by ci-check.sh.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PROBE_TIMEOUT_MS = 1_000;

interface Target {
  /** Service name in docker/compose.infra.yaml. */
  service: string;
  envVar: string;
  host: string;
  port: number;
}

function target(service: string, envVar: string, url: string | undefined, defaultPort: number) {
  if (!url) {
    throw new Error(`${envVar} is not set; cannot prepare integration test infra`);
  }
  const parsed = new URL(url);
  return {
    service,
    envVar,
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : defaultPort,
  } satisfies Target;
}

function isListening({ host, port }: Target): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port, timeout: PROBE_TIMEOUT_MS });
    const finish = (up: boolean) => {
      socket.destroy();
      done(up);
    };
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function findDown(targets: Target[]): Promise<Target[]> {
  const up = await Promise.all(targets.map(isListening));
  return targets.filter((_, i) => !up[i]);
}

const describe = (targets: Target[]) =>
  targets.map((t) => `${t.service} (${t.envVar} → ${t.host}:${t.port})`).join(', ');

export async function ensureIntegrationInfra(workspaceRoot: string): Promise<void> {
  const targets = [
    target('postgres', 'DATABASE_URL_TEST_MIGRATE', process.env.DATABASE_URL_TEST_MIGRATE, 5432),
    target('redis', 'REDIS_URL', process.env.REDIS_URL, 6379),
    target('nats', 'NATS_URL', process.env.NATS_URL, 4222),
    target(
      'nats-test',
      'NATS_TEST_URL',
      process.env.NATS_TEST_URL ?? 'nats://localhost:4224',
      4222,
    ),
  ];

  const down = await findDown(targets);
  if (down.length === 0) return;

  const remote = down.filter((t) => !LOCAL_HOSTS.has(t.host));
  if (remote.length > 0) {
    throw new Error(`Integration test infra is not reachable: ${describe(remote)}`);
  }

  console.log(`Integration test infra is down: ${describe(down)}`);
  console.log('Starting it from docker/compose.infra.yaml...');
  const services = down.map((t) => t.service);
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'docker/compose.infra.yaml',
      'up',
      '-d',
      '--no-recreate',
      '--wait',
      ...services,
    ],
    { cwd: workspaceRoot, stdio: 'inherit' },
  );
  if (result.error || result.status !== 0) {
    const why = result.error ? result.error.message : `exit ${result.status}`;
    throw new Error(
      `Integration test infra is down (${describe(down)}) and could not be started (${why}). Run \`tilt up\` or \`pnpm infra:up\`.`,
    );
  }

  const stillDown = await findDown(down);
  if (stillDown.length > 0) {
    throw new Error(`Started the dev infra but still cannot connect: ${describe(stillDown)}`);
  }
  console.log(`✓ Integration test infra started: ${services.join(', ')}`);
}

if (process.argv[1]?.endsWith('int-infra.ts')) {
  ensureIntegrationInfra(process.cwd()).catch((error: unknown) => {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
