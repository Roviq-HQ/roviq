import type { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenObserveClient, OpenObserveUnavailableError } from '../openobserve.client';

const CREDENTIALS = { OPENOBSERVE_USER: 'dev@roviq.local', OPENOBSERVE_PASSWORD: 'secret' };
const BASE = { ...CREDENTIALS, OPENOBSERVE_URL: 'http://o2.test' };
const EMPTY_VECTOR = { status: 'success', data: { resultType: 'vector', result: [] } };

function clientWith(values: Record<string, string>): OpenObserveClient {
  return new OpenObserveClient(
    createMock<ConfigService>({ get: vi.fn((key: string) => values[key]) }),
  );
}

function stubFetchJson(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestedUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
  const [url] = fetchMock.mock.calls[0] ?? [];
  if (!(url instanceof URL)) throw new Error('fetch was not called with a URL');
  return url;
}

function requestedHeaders(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const [, init] = fetchMock.mock.calls[0] ?? [];
  return init?.headers;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenObserveClient', () => {
  describe('request target', () => {
    it('should prefer OPENOBSERVE_URL and put the org in the path', async () => {
      const fetchMock = stubFetchJson(EMPTY_VECTOR);

      await clientWith({
        ...CREDENTIALS,
        OPENOBSERVE_URL: 'http://o2.test:9999',
        OPENOBSERVE_ORG: 'roviq',
        DEV_OPENOBSERVE_PORT: '5100',
      }).query('up');

      const url = requestedUrl(fetchMock);
      expect(`${url.origin}${url.pathname}`).toBe(
        'http://o2.test:9999/api/roviq/prometheus/api/v1/query',
      );
    });

    it("should fall back to this instance's DEV_OPENOBSERVE_PORT and the default org", async () => {
      const fetchMock = stubFetchJson(EMPTY_VECTOR);

      await clientWith({ ...CREDENTIALS, DEV_OPENOBSERVE_PORT: '5100' }).query('up');

      const url = requestedUrl(fetchMock);
      expect(`${url.origin}${url.pathname}`).toBe(
        'http://localhost:5100/api/default/prometheus/api/v1/query',
      );
    });

    it('should send Basic auth built from OPENOBSERVE_USER and OPENOBSERVE_PASSWORD', async () => {
      const fetchMock = stubFetchJson(EMPTY_VECTOR);

      await clientWith(BASE).query('up');

      expect(requestedHeaders(fetchMock)).toEqual({
        authorization: `Basic ${Buffer.from('dev@roviq.local:secret').toString('base64')}`,
      });
    });

    it.each([
      ['user', { OPENOBSERVE_URL: 'http://o2.test', OPENOBSERVE_PASSWORD: 'secret' }],
      ['password', { OPENOBSERVE_URL: 'http://o2.test', OPENOBSERVE_USER: 'dev@roviq.local' }],
    ])('should be unavailable without a request when the %s is unset', async (_, values) => {
      const fetchMock = stubFetchJson(EMPTY_VECTOR);

      await expect(clientWith(values).query('up')).rejects.toThrow(
        'OpenObserve credentials are not configured',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('query', () => {
    it('should parse an instant vector into numeric samples', async () => {
      const fetchMock = stubFetchJson({
        status: 'success',
        data: {
          resultType: 'vector',
          result: [{ metric: { tenant_id: 't1' }, value: [1_700_000_000, '42.5'] }],
        },
      });

      const samples = await clientWith(BASE).query('up');

      expect(samples).toEqual([{ metric: { tenant_id: 't1' }, value: 42.5 }]);
      expect(requestedUrl(fetchMock).searchParams.get('query')).toBe('up');
    });
  });

  describe('queryRange', () => {
    it('should send start/end/step and parse matrix values', async () => {
      const fetchMock = stubFetchJson({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {},
              values: [
                [100, '1'],
                [160, '2'],
              ],
            },
          ],
        },
      });

      const series = await clientWith(BASE).queryRange('rate(x[1m])', 100, 160, 60);

      expect(series).toEqual([
        {
          metric: {},
          values: [
            [100, 1],
            [160, 2],
          ],
        },
      ]);
      const url = requestedUrl(fetchMock);
      expect(url.pathname).toBe('/api/default/prometheus/api/v1/query_range');
      const params = url.searchParams;
      expect([params.get('start'), params.get('end'), params.get('step')]).toEqual([
        '100',
        '160',
        '60',
      ]);
    });
  });

  describe('alerts', () => {
    const SINCE_MICROS = 1_795_451_607_677_613;

    function listEntry(id: string, overrides: Record<string, unknown> = {}) {
      return {
        alert_id: id,
        name: id,
        enabled: true,
        last_outcome: 'firing',
        last_outcome_since: SINCE_MICROS,
        ...overrides,
      };
    }

    /** Answers by path; a path missing from `routes` returns HTTP 500. */
    function stubAlertsApi(routes: Record<string, unknown>) {
      const fetchMock = vi.fn(async (url: URL) => {
        const body = routes[url.pathname];
        return body === undefined
          ? new Response('boom', { status: 500 })
          : new Response(JSON.stringify(body), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('should return nothing and fetch no detail when no alert is firing', async () => {
      const fetchMock = stubAlertsApi({
        '/api/v2/default/alerts': {
          list: [
            listEntry('a1', { last_outcome: 'not_firing' }),
            listEntry('a2', { last_outcome: null }),
          ],
        },
      });

      await expect(clientWith(BASE).alerts()).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should map a firing alert with its context attributes as labels', async () => {
      stubAlertsApi({
        '/api/v2/default/alerts': {
          list: [listEntry('a1'), listEntry('a2', { last_outcome: 'not_firing' })],
        },
        '/api/v2/default/alerts/a1': {
          name: 'DlqMessages',
          description: 'DLQ growing',
          context_attributes: { severity: 'warning', component: 'nats', runbook: 'docs/x.md' },
        },
      });

      await expect(clientWith(BASE).alerts()).resolves.toEqual([
        {
          labels: {
            alertname: 'DlqMessages',
            severity: 'warning',
            component: 'nats',
            runbook: 'docs/x.md',
          },
          annotations: { summary: 'DLQ growing' },
          state: 'firing',
          activeAt: new Date(SINCE_MICROS / 1_000).toISOString(),
          condition: null,
        },
      ]);
    });

    it("should return a PromQL rule's query and condition", async () => {
      stubAlertsApi({
        '/api/v2/default/alerts': { list: [listEntry('a1')] },
        '/api/v2/default/alerts/a1': {
          name: 'notification_canary_missing',
          context_attributes: { severity: 'page' },
          query_condition: {
            type: 'promql',
            promql: 'time() - max by (channel) (notification_canary_last_success)',
            promql_condition: { column: 'value', operator: '>', value: 1800 },
          },
        },
      });

      const [alert] = await clientWith(BASE).alerts();

      expect(alert?.condition).toEqual({
        promql: 'time() - max by (channel) (notification_canary_last_success)',
        operator: '>',
        value: 1800,
      });
    });

    it('should ignore a disabled alert even when its last outcome was firing', async () => {
      const fetchMock = stubAlertsApi({
        '/api/v2/default/alerts': { list: [listEntry('a1', { enabled: false })] },
      });

      await expect(clientWith(BASE).alerts()).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should be unavailable when a firing alert detail cannot be read', async () => {
      stubAlertsApi({
        '/api/v2/default/alerts': { list: [listEntry('a1'), listEntry('a2')] },
        '/api/v2/default/alerts/a1': { name: 'A1', description: 'a', context_attributes: {} },
      });

      await expect(clientWith(BASE).alerts()).rejects.toThrow(
        'OpenObserve alert detail returned HTTP 500',
      );
    });

    it('should be unavailable when the alert list has an unexpected shape', async () => {
      stubAlertsApi({ '/api/v2/default/alerts': { alerts: [] } });

      await expect(clientWith(BASE).alerts()).rejects.toThrow(
        'OpenObserve alerts has an unexpected shape',
      );
    });

    it('should be unavailable without a request when credentials are missing', async () => {
      const fetchMock = stubAlertsApi({});

      await expect(clientWith({ OPENOBSERVE_URL: 'http://o2.test' }).alerts()).rejects.toThrow(
        OpenObserveUnavailableError,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it('should throw OpenObserveUnavailableError when the network call fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

      await expect(clientWith(BASE).query('up')).rejects.toThrow(OpenObserveUnavailableError);
    });

    it('should throw OpenObserveUnavailableError on a non-2xx status', async () => {
      stubFetchJson({ status: 'error', error: 'bad' }, 401);

      await expect(clientWith(BASE).query('up')).rejects.toThrow(
        'OpenObserve query returned HTTP 401',
      );
    });

    it('should throw OpenObserveUnavailableError when OpenObserve reports an error', async () => {
      stubFetchJson({ status: 'error', error: 'parse error' });

      await expect(clientWith(BASE).query('up(')).rejects.toThrow(
        'OpenObserve query error: parse error',
      );
    });

    it('should throw OpenObserveUnavailableError on an unexpected result type', async () => {
      stubFetchJson({ status: 'success', data: { resultType: 'matrix', result: [] } });

      await expect(clientWith(BASE).query('up')).rejects.toThrow(OpenObserveUnavailableError);
    });
  });
  describe('raw reads for the observability pages', () => {
    it('should POST a search with the SQL, the window in microseconds and the page size', async () => {
      const fetchMock = stubFetchJson({ hits: [{ body: 'line' }] });

      const body = await clientWith(BASE).search({
        type: 'logs',
        sql: 'SELECT body FROM "default"',
        sinceSeconds: 60,
        size: 7,
      });

      expect(body).toEqual({ hits: [{ body: 'line' }] });
      const url = requestedUrl(fetchMock);
      expect(url.pathname).toBe('/api/default/_search');
      expect(url.searchParams.get('type')).toBe('logs');
      const [, init] = fetchMock.mock.calls[0] ?? [];
      expect(init?.method).toBe('POST');
      const sent = JSON.parse(String(init?.body));
      expect(sent.query).toMatchObject({ sql: 'SELECT body FROM "default"', from: 0, size: 7 });
      expect(sent.query.end_time - sent.query.start_time).toBe(60 * 1_000_000);
      // Microseconds since the epoch: sixteen digits today.
      expect(String(sent.query.end_time)).toHaveLength(16);
    });

    it('should answer the Prometheus envelope as sent, also for a query the store refuses', async () => {
      stubFetchJson({ status: 'error', error: 'parse error' }, 400);

      expect(await clientWith(BASE).prometheus('query', { query: 'up(' })).toEqual({
        status: 'error',
        error: 'parse error',
      });
    });

    it('should fail a raw read when the store answers a server error', async () => {
      stubFetchJson({}, 503);

      await expect(clientWith(BASE).prometheus('query', { query: 'up' })).rejects.toThrow(
        OpenObserveUnavailableError,
      );
    });
  });
});
