// @vitest-environment node
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAlerts } from '../alerts/route';
import { GET as getLogs } from '../logs/route';
import { GET as getMetrics } from '../metrics/route';
import { GET as getTraces } from '../traces/route';

const SECRET = 'observability-routes-spec-secret';
const BASE = 'http://openobserve.test:5080';
const BASIC = `Basic ${Buffer.from('ops@example.test:pw-1').toString('base64')}`;
const THIRTY_DAYS_US = 30 * 24 * 60 * 60 * 1_000_000;

interface Call {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
}

let calls: Call[];
let responder: (url: URL) => Response | Promise<Response>;

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', SECRET);
  vi.stubEnv('OPENOBSERVE_URL', BASE);
  vi.stubEnv('OPENOBSERVE_ORG', 'default');
  vi.stubEnv('OPENOBSERVE_USER', 'ops@example.test');
  vi.stubEnv('OPENOBSERVE_PASSWORD', 'pw-1');
  calls = [];
  responder = () => Response.json({ hits: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      calls.push({
        url,
        method: init.method ?? 'GET',
        headers: new Headers(init.headers),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return responder(url);
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function adminRequest(path: string, scope = 'platform'): Request {
  const token = jwt.sign({ sub: 'user-1', scope }, SECRET);
  return new Request(`http://admin.localhost${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function onlyCall(): Call {
  expect(calls).toHaveLength(1);
  const [call] = calls;
  assert(call);
  return call;
}

function searchQuery(call: Call): {
  sql: string;
  start_time: number;
  end_time: number;
  size: number;
} {
  const body = call.body;
  assert(typeof body === 'object' && body !== null && 'query' in body);
  const query = body.query;
  assert(typeof query === 'object' && query !== null);
  assert('sql' in query && typeof query.sql === 'string');
  assert('start_time' in query && typeof query.start_time === 'number');
  assert('end_time' in query && typeof query.end_time === 'number');
  assert('size' in query && typeof query.size === 'number');
  return {
    sql: query.sql,
    start_time: query.start_time,
    end_time: query.end_time,
    size: query.size,
  };
}

describe('admin auth on the observability routes', () => {
  it.each([
    ['logs', getLogs, '/api/logs'],
    ['traces', getTraces, '/api/traces'],
    ['metrics', getMetrics, '/api/metrics?endpoint=query&query=up'],
    ['alerts', getAlerts, '/api/alerts'],
  ])('should refuse %s without a bearer token', async (_name, handler, path) => {
    const res = await handler(new Request(`http://admin.localhost${path}`));

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('should refuse logs for an institute-scope token', async () => {
    const res = await getLogs(adminRequest('/api/logs', 'institute'));

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe('missing OpenObserve credentials', () => {
  it.each([
    ['logs', getLogs, '/api/logs'],
    ['traces', getTraces, '/api/traces'],
    ['metrics', getMetrics, '/api/metrics?endpoint=query&query=up'],
    ['alerts', getAlerts, '/api/alerts'],
  ])('should answer 502 for %s when the password is unset', async (_name, handler, path) => {
    vi.stubEnv('OPENOBSERVE_PASSWORD', '');

    const res = await handler(adminRequest(path));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'openobserve not configured',
      detail: 'OPENOBSERVE_USER and OPENOBSERVE_PASSWORD must be set on the web server',
    });
    expect(calls).toHaveLength(0);
  });

  it('should answer 502 when OpenObserve is unreachable', async () => {
    responder = () => {
      throw new TypeError('fetch failed');
    };

    const res = await getLogs(adminRequest('/api/logs'));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'openobserve unreachable', detail: 'fetch failed' });
  });
});

describe('GET /api/logs', () => {
  it('should search the logs stream with server-held credentials and no service filter', async () => {
    const res = await getLogs(adminRequest('/api/logs'));

    expect(res.status).toBe(200);
    const call = onlyCall();
    expect(call.method).toBe('POST');
    expect(call.url.toString()).toBe(`${BASE}/api/default/_search?type=logs`);
    expect(call.headers.get('authorization')).toBe(BASIC);
    const query = searchQuery(call);
    expect(query.sql).toBe(
      'SELECT _timestamp, severity, service_name, body FROM "default" ORDER BY _timestamp DESC',
    );
    expect(query.size).toBe(50);
    expect(query.end_time - query.start_time).toBe(3600 * 1_000_000);
  });

  it('should filter by validated service names', async () => {
    await getLogs(adminRequest('/api/logs?services=api-gateway,notification-service'));

    expect(searchQuery(onlyCall()).sql).toBe(
      "SELECT _timestamp, severity, service_name, body FROM \"default\" WHERE service_name IN ('api-gateway', 'notification-service') ORDER BY _timestamp DESC",
    );
  });

  it.each([
    ["api-gateway') OR 1=1 --"],
    ['api-gateway,"default"'],
    ['api gateway'],
  ])('should refuse the service filter %s with 400 before querying', async (services) => {
    const res = await getLogs(adminRequest(`/api/logs?services=${encodeURIComponent(services)}`));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid service name' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['9999', 500],
    ['0', 1],
    ['abc', 50],
  ])('should clamp limit=%s to %i', async (limit, expected) => {
    await getLogs(adminRequest(`/api/logs?limit=${limit}`));

    expect(searchQuery(onlyCall()).size).toBe(expected);
  });

  it('should clamp the range to 30 days', async () => {
    await getLogs(adminRequest('/api/logs?sinceSeconds=999999999'));

    const query = searchQuery(onlyCall());
    expect(query.end_time - query.start_time).toBe(THIRTY_DAYS_US);
  });
});

describe('GET /api/traces', () => {
  it('should select root server and consumer spans without health checks or introspection', async () => {
    await getTraces(adminRequest('/api/traces'));

    const call = onlyCall();
    expect(call.url.toString()).toBe(`${BASE}/api/default/_search?type=traces`);
    const query = searchQuery(call);
    expect(query.sql).toBe(
      'SELECT _timestamp, trace_id, service_name, operation_name, duration FROM "default" WHERE ' +
        "(reference_parent_span_id IS NULL OR reference_parent_span_id = '') AND " +
        "span_kind IN ('2', '5') AND service_name <> 'compose' AND " +
        "operation_name NOT LIKE 'GET /api/health%' AND operation_name <> 'HEAD /_ping' AND " +
        'trace_id NOT IN (SELECT trace_id FROM "default" WHERE operation_name = \'query IntrospectionQuery\') ' +
        'ORDER BY _timestamp DESC',
    );
    expect(query.size).toBe(20);
  });

  it('should add the validated service filter', async () => {
    await getTraces(adminRequest('/api/traces?services=api-gateway'));

    expect(searchQuery(onlyCall()).sql).toContain(" AND service_name IN ('api-gateway') ORDER BY");
  });

  it('should refuse an injection attempt in the service filter with 400', async () => {
    const res = await getTraces(
      adminRequest(`/api/traces?services=${encodeURIComponent("x' OR '1'='1")}`),
    );

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('should clamp limit and range', async () => {
    await getTraces(adminRequest('/api/traces?limit=5000&sinceSeconds=-20'));

    const query = searchQuery(onlyCall());
    expect(query.size).toBe(100);
    expect(query.end_time - query.start_time).toBe(1_000_000);
  });
});

describe('GET /api/metrics', () => {
  it('should forward an instant PromQL query to the PromQL-compatible API', async () => {
    responder = () =>
      Response.json({ status: 'success', data: { resultType: 'vector', result: [] } });

    const res = await getMetrics(adminRequest('/api/metrics?endpoint=query&query=up'));

    expect(res.status).toBe(200);
    const call = onlyCall();
    expect(call.method).toBe('GET');
    expect(call.headers.get('authorization')).toBe(BASIC);
    expect(`${call.url.origin}${call.url.pathname}`).toBe(
      `${BASE}/api/default/prometheus/api/v1/query`,
    );
    expect(call.url.searchParams.get('query')).toBe('up');
  });

  it('should clamp step and range on query_range', async () => {
    await getMetrics(
      adminRequest('/api/metrics?endpoint=query_range&query=up&step=1&start=0&end=4000000000'),
    );

    const params = onlyCall().url.searchParams;
    expect(params.get('step')).toBe('5');
    expect(params.get('end')).toBe('4000000000');
    expect(params.get('start')).toBe(String(4_000_000_000 - 30 * 24 * 60 * 60));
  });

  it('should refuse an endpoint outside the allowlist', async () => {
    const res = await getMetrics(adminRequest('/api/metrics?endpoint=series&query=up'));

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/alerts', () => {
  const LIST_PATH = '/api/v2/default/alerts';

  function alertsUpstream(
    list: unknown[],
    details: Record<string, unknown>,
  ): (url: URL) => Response {
    return (url) => {
      if (url.pathname === LIST_PATH) return Response.json({ list });
      const id = url.pathname.slice(LIST_PATH.length + 1);
      const detail = details[id];
      return detail === undefined
        ? Response.json({ code: 404, message: 'not found' }, { status: 404 })
        : Response.json(detail);
    };
  }

  it('should return no alerts when none is firing', async () => {
    responder = alertsUpstream(
      [{ alert_id: 'a1', enabled: true, last_outcome: 'ok', name: 'HighErrorRate' }],
      {},
    );

    const res = await getAlerts(adminRequest('/api/alerts'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success', data: { alerts: [] } });
    expect(calls).toHaveLength(1);
  });

  it('should map a firing alert with its context attributes and nothing else', async () => {
    responder = alertsUpstream(
      [
        {
          alert_id: 'a1',
          enabled: true,
          last_outcome: 'firing',
          last_outcome_since: 1_795_451_607_677_613,
          owner: 'ops@example.test',
        },
      ],
      {
        a1: {
          name: 'HighErrorRate',
          description: '5xx above 5%',
          context_attributes: { severity: 'critical', component: 'api-gateway', runbook: 'r.md' },
          owner: 'ops@example.test',
          query_condition: { promql: 'sum(rate(x[5m]))' },
        },
      },
    );

    const res = await getAlerts(adminRequest('/api/alerts'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'success',
      data: {
        alerts: [
          {
            labels: {
              alertname: 'HighErrorRate',
              severity: 'critical',
              component: 'api-gateway',
              runbook: 'r.md',
            },
            annotations: { summary: '5xx above 5%' },
            state: 'firing',
            activeAt: new Date(1_795_451_607_677).toISOString(),
          },
        ],
      },
    });
    expect(calls.map((c) => c.url.pathname)).toEqual([LIST_PATH, `${LIST_PATH}/a1`]);
  });

  it('should ignore an alert that is firing but disabled', async () => {
    responder = alertsUpstream([{ alert_id: 'a1', enabled: false, last_outcome: 'firing' }], {
      a1: { name: 'HighErrorRate', description: '', context_attributes: {} },
    });

    const res = await getAlerts(adminRequest('/api/alerts'));

    expect(await res.json()).toEqual({ status: 'success', data: { alerts: [] } });
    expect(calls).toHaveLength(1);
  });

  it('should answer 502 when the alert list request fails', async () => {
    responder = () => Response.json({ code: 500, message: 'boom' }, { status: 500 });

    const res = await getAlerts(adminRequest('/api/alerts'));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'openobserve error',
      detail: 'unexpected alert list response (HTTP 500)',
    });
  });

  it('should answer 502 when the alert list has an unexpected shape', async () => {
    responder = () => Response.json({ list: [{ name: 'no id' }] });

    const res = await getAlerts(adminRequest('/api/alerts'));

    expect(res.status).toBe(502);
  });

  it('should answer 502 when a firing alert detail cannot be read', async () => {
    responder = alertsUpstream([{ alert_id: 'gone', enabled: true, last_outcome: 'firing' }], {});

    const res = await getAlerts(adminRequest('/api/alerts'));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'openobserve error',
      detail: 'unexpected alert detail response (HTTP 404)',
    });
  });
});
