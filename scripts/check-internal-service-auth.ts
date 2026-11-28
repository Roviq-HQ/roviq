// Gate check, run against the e2e stack once it is up — the internal services ask for their
// credentials:
//   - Redis answers NOAUTH to a client that sends no password;
//   - NATS refuses a connection without a user;
//   - Temporal's database role can sign in and can read nothing of the application's database.
// The rule in words: docs/deployment.md → "Internal services".

import { execFileSync } from 'node:child_process';
import { connect } from '@nats-io/transport-node';
import pg from 'pg';

export interface Probe {
  service: string;
  /** What the service answered to a client without credentials (or with another's). */
  answer: string;
}

/** Redis refused the command for lack of a password. */
export function redisRefused(answer: string): boolean {
  return /\bNOAUTH\b/.test(answer);
}

/** NATS closed the connection for lack of a user. */
export function natsRefused(answer: string): boolean {
  return /AUTHORIZATION_VIOLATION|Authorization Violation|authorization violation/i.test(answer);
}

/** PostgreSQL refused the read for lack of a privilege. */
export function postgresRefused(answer: string): boolean {
  return /permission denied/i.test(answer);
}

export function problems(probes: readonly Probe[]): string[] {
  const refused: Record<string, (answer: string) => boolean> = {
    redis: redisRefused,
    nats: natsRefused,
    'temporal database role': postgresRefused,
  };
  return probes
    .filter((probe) => !refused[probe.service]?.(probe.answer))
    .map(
      (probe) =>
        `${probe.service}: expected a refusal, got: ${probe.answer.trim().slice(0, 200) || '(nothing)'}`,
    );
}

function probeRedis(): Probe {
  // Redis publishes no port in the e2e stack, so the probe runs in its container, with the
  // variable that would sign the client in emptied.
  let answer: string;
  try {
    answer = execFileSync(
      'bash',
      [
        'scripts/e2e-compose.sh',
        'exec',
        '-T',
        '-e',
        'REDISCLI_AUTH=',
        'redis',
        'redis-cli',
        'dbsize',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    answer = error instanceof Error ? error.message : String(error);
  }
  return { service: 'redis', answer };
}

async function probeNats(): Promise<Probe> {
  const port = process.env.E2E_NATS_PORT ?? '4223';
  try {
    const nc = await connect({
      servers: `nats://localhost:${port}`,
      timeout: 5_000,
      reconnect: false,
    });
    await nc.close();
    return { service: 'nats', answer: 'connected without a user' };
  } catch (error) {
    return { service: 'nats', answer: error instanceof Error ? error.message : String(error) };
  }
}

async function probeTemporalRole(): Promise<Probe> {
  const port = process.env.E2E_POSTGRES_PORT ?? '5435';
  const client = new pg.Client({
    connectionString: `postgresql://roviq_temporal:roviq_temporal_dev@localhost:${port}/roviq_test`,
  });
  try {
    await client.connect();
    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
      return {
        service: 'temporal database role',
        answer: 'the role is a superuser or bypasses row security',
      };
    }
    await client.query('SELECT count(*) FROM users');
    return { service: 'temporal database role', answer: 'read the users table' };
  } catch (error) {
    return {
      service: 'temporal database role',
      answer: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const found = problems([probeRedis(), await probeNats(), await probeTemporalRole()]);
  if (found.length === 0) {
    process.stdout.write(
      'check:internal-service-auth — Redis and NATS refuse a client without credentials; the Temporal database role reads nothing of the application.\n',
    );
    return 0;
  }
  process.stderr.write(`check:internal-service-auth — ${found.length} problem(s):\n\n`);
  for (const problem of found) process.stderr.write(`  ${problem}\n`);
  process.stderr.write(
    '\nThe e2e stack must be up (pnpm e2e:up). Credentials: docker/compose.e2e.yaml, docker/nats.conf.\n',
  );
  return 1;
}

if (process.argv[1]?.endsWith('check-internal-service-auth.ts')) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(
        `check:internal-service-auth — ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
}
