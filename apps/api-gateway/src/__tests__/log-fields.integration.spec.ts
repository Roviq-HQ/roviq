/**
 * Request logs hold listed fields only (ROV-390). Requests carry marker values in a header,
 * a cookie, a query string, GraphQL variables and a webhook body, on a refused request and on
 * one that fails with a database error; no marker may appear in any log line the gateway
 * writes, and every field of every line must be on the list.
 */
import { Writable } from 'node:stream';
import {
  createListedLogger,
  DROPPED_FIELDS_KEY,
  LOG_FIELDS,
  requestLoggerParams,
} from '@roviq/telemetry';
import {
  createIntegrationApp,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { sql } from 'drizzle-orm';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app/app.module';
import { AuthService } from '../auth/auth.service';

const MARKERS = {
  header: 'marker-header-7f3a91',
  cookie: 'marker-cookie-2c8e44',
  query: 'marker-query-9d1b63',
  name: 'Aarav Markerson',
  phone: '9876500011',
  password: 'Marker#Pass-5e2f',
  body: 'marker-body-41ac07',
} as const;
const ANY_MARKER = new RegExp(
  Object.values(MARKERS)
    .map((marker) => marker.replace(/[#.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
);
/** What pino itself writes on every line. */
const PINO_FIELDS = ['level', 'time', 'msg'];

const LOGIN = /* GraphQL */ `
  mutation Login($username: String!, $password: String!) {
    instituteLogin(username: $username, password: $password) {
      accessToken
    }
  }
`;

describe('gateway log lines hold listed fields only (ROV-390)', () => {
  let result: IntegrationAppResult;
  const lines: string[] = [];
  const records = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  beforeAll(async () => {
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        {
          provide: PARAMS_PROVIDER_TOKEN,
          useValue: requestLoggerParams(createListedLogger({ level: 'trace' }, stream), false),
        },
      ],
    });
    // As main.ts does: every `new Logger(...)` of the application writes through pino.
    result.app.useLogger(result.app.get(Logger));
  });

  afterAll(async () => {
    await result?.close();
  });

  beforeEach(() => {
    lines.length = 0;
  });

  const send = (variables: Record<string, unknown>) =>
    request(result.httpServer)
      .post(`/api/graphql?code=${MARKERS.query}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${MARKERS.header}`)
      .set('X-Api-Key', MARKERS.header)
      .set('Cookie', `refresh_token=${MARKERS.cookie}`)
      .send({ query: LOGIN, variables });

  const expectListedFieldsOnly = () => {
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toMatch(ANY_MARKER);
    const unlisted = new Set<string>();
    const dropped = new Set<string>();
    for (const record of records()) {
      for (const key of Object.keys(record)) {
        if (key === DROPPED_FIELDS_KEY) {
          for (const name of record[key] as string[]) dropped.add(name);
        } else if (!LOG_FIELDS.has(key) && !PINO_FIELDS.includes(key)) unlisted.add(key);
      }
    }
    expect([...unlisted]).toEqual([]);
    // A dropped field means a call site logs something that is not on the list.
    expect([...dropped]).toEqual([]);
  };

  it('should log a refused sign-in without its header, cookie, query or variables', async () => {
    const response = await send({ username: MARKERS.name, password: MARKERS.password });

    expect(response.body.errors?.[0]?.extensions?.code).toBeDefined();
    const requestLines = records().filter((record) => record.req !== undefined);
    expect(requestLines.length).toBeGreaterThan(0);
    for (const record of requestLines) {
      expect(Object.keys(record.req as object).sort()).toEqual(['id', 'method', 'url']);
      expect((record.req as { url: string }).url).toBe('/api/graphql');
    }
    expectListedFieldsOnly();
  });

  it('should log a database failure without the values of the failed query', async () => {
    // A real driver error whose message carries the parameter values.
    const failure = await result.db
      .execute(
        sql`select 1 / (length(${MARKERS.name}) - length(${MARKERS.name})), ${MARKERS.phone}, ${MARKERS.password}`,
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(String((failure as Error).message)).toMatch(ANY_MARKER);
    vi.spyOn(AuthService.prototype, 'instituteLogin').mockRejectedValue(failure);

    const response = await send({ username: MARKERS.name, password: MARKERS.password });

    expect(response.body.errors?.[0]?.extensions?.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(ANY_MARKER);
    const failures = records().filter((record) => record.err !== undefined);
    expect(failures.length).toBeGreaterThan(0);
    for (const record of failures) {
      expect(Object.keys(record.err as object).sort()).toEqual(
        expect.arrayContaining(['message', 'type']),
      );
      expect(
        Object.keys(record.err as object).filter(
          (key) => !['type', 'message', 'stack', 'code', 'cause'].includes(key),
        ),
      ).toEqual([]);
    }
    expect(lines.join('')).toContain('Failed query');
    expectListedFieldsOnly();
  });

  it('should log a payment webhook without its body', async () => {
    const response = await request(result.httpServer)
      .post(`/api/webhooks/razorpay/${MARKERS.query}`)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', MARKERS.header)
      .send({ payload: { payment: { entity: { contact: MARKERS.phone, notes: MARKERS.body } } } });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(lines.join('')).not.toContain(MARKERS.header);
    expect(lines.join('')).not.toContain(MARKERS.phone);
    expect(lines.join('')).not.toContain(MARKERS.body);
  });

  it('should still answer the caller with the usual result', async () => {
    const res = await gqlRequest(result.httpServer, { query: '{ __typename }' });

    expect(res.errors).toBeUndefined();
  });
});
