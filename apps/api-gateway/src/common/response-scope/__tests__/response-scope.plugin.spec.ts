import assert from 'node:assert/strict';
import type { GraphQLRequestContextWillSendResponse } from '@apollo/server';
import type { ConfigService } from '@nestjs/config';
import type { AuthUser } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import type { GraphQLResolveInfo } from 'graphql';
import { describe, expect, it, vi } from 'vitest';
import { ResponseScopePlugin } from '../response-scope.plugin';
import { ResponseScopeGauge } from '../response-scope-gauge';

vi.mock('../response-scope.allowlist', () => ({
  FOREIGN_SCOPE_ALLOWED: { listedOperation: 'a reason' },
}));

const OWN = '019b0000-0000-7000-8000-0000000000aa';
const OTHER = '019b0000-0000-7000-8000-0000000000bb';

const institute = createMock<AuthUser>({ scope: 'institute', tenantId: OWN });
const reseller = createMock<AuthUser>({ scope: 'reseller', resellerId: OWN });
const platform = createMock<AuthUser>({ scope: 'platform' });

class SmallLimitPlugin extends ResponseScopePlugin {
  protected override readonly maxNodes = 5;
}

interface Resolved {
  /** Response path from the root, e.g. ['students', 0, 'guardians']. */
  path: Array<string | number>;
  field?: string;
  source?: unknown;
  result: unknown;
}

type Context = { req?: { user?: AuthUser } };

async function run(options: {
  mode?: string;
  user?: AuthUser;
  fields: Resolved[];
  operation?: 'query' | 'mutation' | 'subscription';
  smallLimit?: boolean;
}) {
  const gauge = new ResponseScopeGauge();
  const config = createMock<ConfigService>({ get: vi.fn(() => options.mode) });
  const plugin = options.smallLimit
    ? new SmallLimitPlugin(config, gauge)
    : new ResponseScopePlugin(config, gauge);
  const contextValue: Context = { req: { user: options.user } };
  const sent = { kind: 'single' as const, singleResult: { data: { some: 'data' } as unknown } };
  const listener = await plugin.requestDidStart();
  const execution = await listener.executionDidStart?.(createMock());

  for (const resolved of options.fields) {
    const path = resolved.path.reduce<GraphQLResolveInfo['path'] | undefined>(
      (prev, key) => ({ prev, key, typename: undefined }),
      undefined,
    );
    assert(path);
    const fieldName = resolved.field ?? String(resolved.path.at(-1));
    const info = createMock<GraphQLResolveInfo>({
      path,
      fieldName,
      parentType: { name: resolved.path.length === 1 ? 'Query' : 'Row' },
      operation: { operation: options.operation ?? 'query', name: { value: 'TestOperation' } },
    });
    const done = execution?.willResolveField?.({
      source: resolved.source,
      args: {},
      contextValue,
      info,
    });
    done?.(null, resolved.result);
  }
  await listener.willSendResponse?.(
    createMock<GraphQLRequestContextWillSendResponse<Context>>({
      contextValue,
      response: { body: sent },
    }),
  );
  const counts = Object.fromEntries(
    gauge.readings().map((r) => [`${r.scope}/${r.reason}`, r.count]),
  );
  return { sent: sent.singleResult, counts };
}

const REFUSED = {
  data: null,
  errors: [
    { message: 'Internal server error', extensions: { code: 'INTERNAL_ERROR', statusCode: 500 } },
  ],
};
const UNTOUCHED = { data: { some: 'data' } };

describe('ResponseScopePlugin', () => {
  it("should send a response whose rows are the caller's own", async () => {
    const { sent, counts } = await run({
      user: institute,
      fields: [{ path: ['students'], result: [{ tenantId: OWN }] }],
    });
    expect(sent).toEqual(UNTOUCHED);
    expect(counts['institute/foreign_id']).toBe(0);
  });

  it("should replace the whole response when a root field returns another institute's row", async () => {
    const { sent, counts } = await run({
      user: institute,
      fields: [{ path: ['students'], result: [{ tenantId: OTHER }] }],
    });
    expect(sent).toEqual(REFUSED);
    expect(counts['institute/foreign_id']).toBe(1);
  });

  it("should replace the whole response when a nested field resolver returns another institute's row", async () => {
    const parent = { tenantId: OWN };
    const { sent, counts } = await run({
      user: institute,
      fields: [
        { path: ['students'], result: [parent] },
        { path: ['students', 0, 'guardians'], source: parent, result: [{ tenantId: OTHER }] },
      ],
    });
    expect(sent).toEqual(REFUSED);
    expect(counts['institute/foreign_id']).toBe(1);
  });

  it('should not read again a value that came straight off its parent', async () => {
    const guardians = Array.from({ length: 10 }, () => ({ tenantId: OWN }));
    const parent = { tenantId: OWN, guardians };
    // The root walk of 12 objects would trip the limit of 5; the nested field must not walk at all.
    const { sent, counts } = await run({
      user: institute,
      smallLimit: true,
      fields: [{ path: ['students', 0, 'guardians'], source: parent, result: guardians }],
    });
    expect(sent).toEqual(UNTOUCHED);
    expect(counts['institute/too_large']).toBe(0);
  });

  it('should refuse a reseller a row of another reseller', async () => {
    const { sent, counts } = await run({
      user: reseller,
      fields: [{ path: ['institutes'], result: [{ resellerId: OTHER }] }],
    });
    expect(sent).toEqual(REFUSED);
    expect(counts['reseller/foreign_id']).toBe(1);
  });

  it('should refuse and count a value too large to read in full', async () => {
    const rows = Array.from({ length: 10 }, () => ({ tenantId: OWN }));
    const { sent, counts } = await run({
      user: institute,
      smallLimit: true,
      fields: [{ path: ['students'], result: rows }],
    });
    expect(sent).toEqual(REFUSED);
    expect(counts).toMatchObject({ 'institute/too_large': 1, 'institute/foreign_id': 0 });
  });

  it('should count and still send in report mode, for a foreign id and for a large value', async () => {
    const foreign = await run({
      mode: 'report',
      user: institute,
      fields: [{ path: ['students'], result: [{ tenantId: OTHER }] }],
    });
    expect(foreign.sent).toEqual(UNTOUCHED);
    expect(foreign.counts['institute/foreign_id']).toBe(1);

    const large = await run({
      mode: 'report',
      user: institute,
      smallLimit: true,
      fields: [{ path: ['students'], result: Array.from({ length: 10 }, () => ({})) }],
    });
    expect(large.sent).toEqual(UNTOUCHED);
    expect(large.counts['institute/too_large']).toBe(1);
  });

  it('should do nothing when switched off', async () => {
    const { sent, counts } = await run({
      mode: 'off',
      user: institute,
      fields: [{ path: ['students'], result: [{ tenantId: OTHER }] }],
    });
    expect(sent).toEqual(UNTOUCHED);
    expect(counts['institute/foreign_id']).toBe(0);
  });

  it('should not check a platform caller, a request with no caller or a subscription', async () => {
    const fields = [{ path: ['rows'], result: [{ tenantId: OTHER, resellerId: OTHER }] }];
    expect((await run({ user: platform, fields })).sent).toEqual(UNTOUCHED);
    expect((await run({ fields })).sent).toEqual(UNTOUCHED);
    expect((await run({ user: institute, fields, operation: 'subscription' })).sent).toEqual(
      UNTOUCHED,
    );
  });

  it('should not check an operation on the allowed list, nor the fields under it', async () => {
    const { sent, counts } = await run({
      user: institute,
      fields: [
        { path: ['alias'], field: 'listedOperation', result: { tenantId: OTHER } },
        { path: ['alias', 'user'], source: {}, result: { tenantId: OTHER } },
      ],
    });
    expect(sent).toEqual(UNTOUCHED);
    expect(counts['institute/foreign_id']).toBe(0);
  });

  it('should still check the other root fields of a request that calls an allowed one', async () => {
    const { sent } = await run({
      user: institute,
      fields: [
        { path: ['alias'], field: 'listedOperation', result: { tenantId: OTHER } },
        { path: ['students'], result: [{ tenantId: OTHER }] },
      ],
    });
    expect(sent).toEqual(REFUSED);
  });
});
