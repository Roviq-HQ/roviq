import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createListedLogger,
  DROPPED_FIELDS_KEY,
  keepListedLogFields,
  LOG_FIELDS,
  serializeError,
  withoutQueryValues,
} from '../log-fields';

const PHONE = '9876500011';
const NAME = 'Aarav Marker';
const PASSWORD = 'Marker#Pass1';

/** A logger built like the application's, writing its lines into `lines`. */
function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const logger = createListedLogger({ level: 'debug' }, stream);
  return { logger, lines, records: () => lines.map((line) => JSON.parse(line)) };
}

/** What a database driver throws for a failed insert: the values ride in the message. */
function failedQuery(): Error {
  const cause = Object.assign(new Error('duplicate key value violates unique constraint "u"'), {
    code: '23505',
    detail: `Key (phone)=(${PHONE}) already exists.`,
  });
  const error = new Error(
    `Failed query: insert into "users" ("name", "phone", "password_hash") values ($1, $2, $3)\nparams: ${NAME},${PHONE},${PASSWORD}`,
    { cause },
  );
  return Object.assign(error, {
    name: 'DrizzleQueryError',
    query: 'insert into "users" …',
    params: [NAME, PHONE, PASSWORD],
  });
}

describe('keepListedLogFields', () => {
  it('should keep a listed field and drop the others, naming them', () => {
    expect(keepListedLogFields({ tenantId: 't1', phone: PHONE, headers: { cookie: 'x' } })).toEqual(
      { tenantId: 't1', [DROPPED_FIELDS_KEY]: ['headers', 'phone'] },
    );
  });

  it('should add nothing to a record whose fields are all listed', () => {
    expect(keepListedLogFields({ context: 'Auth', userId: 'u1' })).toEqual({
      context: 'Auth',
      userId: 'u1',
    });
  });

  it('should list no field that names a header, a body, a variable or a contact detail', () => {
    const banned = /header|cookie|authorization|body|variable|password|token|phone|email|name$/i;
    expect([...LOG_FIELDS].filter((field) => banned.test(field))).toEqual(['hostname']);
  });
});

describe('withoutQueryValues', () => {
  it('should cut the parameter values and keep the statement and the stack', () => {
    const text = `Error: Failed query: select $1\nparams: ${PHONE},${NAME}\n    at run (db.ts:1:1)`;

    expect(withoutQueryValues(text)).toBe(
      'Error: Failed query: select $1\nparams: [values not logged]\n    at run (db.ts:1:1)',
    );
  });

  it('should leave a text without query values as it is', () => {
    expect(withoutQueryValues('Could not reach NATS')).toBe('Could not reach NATS');
  });
});

describe('serializeError', () => {
  it('should keep type, message, stack and code, and drop every other property', () => {
    const logged = serializeError(failedQuery());

    expect(Object.keys(logged as object).sort()).toEqual([
      'cause',
      'code',
      'message',
      'stack',
      'type',
    ]);
    expect(logged).toMatchObject({
      type: 'DrizzleQueryError',
      cause: { type: 'Error', code: '23505' },
    });
    expect(JSON.stringify(logged)).not.toMatch(new RegExp(`${PHONE}|${NAME}|${PASSWORD}`));
    expect(JSON.stringify(logged)).toContain('insert into \\"users\\"');
  });

  it('should stop following causes after three levels', () => {
    const deep = new Error('0', {
      cause: new Error('1', {
        cause: new Error('2', { cause: new Error('3', { cause: new Error('4') }) }),
      }),
    });

    expect(JSON.stringify(serializeError(deep))).not.toContain('"message":"4"');
  });
});

describe('a logger built with createListedLogger', () => {
  it('should write listed fields only, for a record and for a child logger', () => {
    const { logger, records } = capture();

    logger.info({ userId: 'u1', variables: { phone: PHONE } }, 'signed in');
    logger.child({ tenantId: 't1', cookie: PASSWORD }).warn({ reason: 'refused' }, 'no');
    logger.child({ module: 'm' }).child({ phone: PHONE, userId: 'u2' }).info('grandchild');

    const [first, second, third] = records();
    expect(third).toMatchObject({ module: 'm', userId: 'u2', msg: 'grandchild' });
    expect(first).toMatchObject({ userId: 'u1', msg: 'signed in', dropped_fields: ['variables'] });
    expect(second).toMatchObject({ tenantId: 't1', reason: 'refused', msg: 'no' });
    expect(JSON.stringify(records())).not.toMatch(new RegExp(`${PHONE}|${PASSWORD}`));
  });

  it('should write no query value of a failed query, as an error or inside a message', () => {
    const { logger, lines } = capture();
    const error = failedQuery();

    logger.error({ err: error }, 'Unhandled GraphQL exception');
    logger.error(`Could not save: ${error.message}`);
    logger.error({ 'dlq.error': error.message }, 'Message dead-lettered');

    expect(lines).toHaveLength(3);
    expect(lines.join('')).not.toMatch(new RegExp(`${PHONE}|${NAME}|${PASSWORD}`));
    expect(lines.join('')).toContain('Failed query: insert into');
  });

  it('should write a request as method, path and status, without headers or query', () => {
    const { logger, lines } = capture();

    logger.info(
      {
        req: {
          id: 'r1',
          method: 'POST',
          url: `/api/graphql?code=${PASSWORD}`,
          headers: { authorization: `Bearer ${PASSWORD}`, cookie: `refresh=${PASSWORD}` },
          body: { variables: { phone: PHONE } },
        },
        res: { statusCode: 200, headers: { 'set-cookie': PASSWORD } },
        responseTime: 12,
      },
      'request completed',
    );

    const record = JSON.parse(lines[0] ?? '{}');
    expect(record.req).toEqual({ id: 'r1', method: 'POST', url: '/api/graphql' });
    expect(record.res).toEqual({ statusCode: 200 });
    expect(lines[0]).not.toMatch(new RegExp(`${PHONE}|${PASSWORD}`));
  });
});
