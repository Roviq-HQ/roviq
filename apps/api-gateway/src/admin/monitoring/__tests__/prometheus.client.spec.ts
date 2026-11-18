import type { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrometheusClient, PrometheusUnavailableError } from '../prometheus.client';

function clientWith(values: Record<string, string>): PrometheusClient {
  return new PrometheusClient(
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PrometheusClient', () => {
  describe('base URL', () => {
    it('should prefer PROMETHEUS_URL', async () => {
      const fetchMock = stubFetchJson({ status: 'success', data: { alerts: [] } });

      await clientWith({
        PROMETHEUS_URL: 'http://prom.test:9999',
        DEV_PROMETHEUS_PORT: '9170',
      }).alerts();

      expect(requestedUrl(fetchMock).toString()).toBe('http://prom.test:9999/api/v1/alerts');
    });

    it("should fall back to this instance's DEV_PROMETHEUS_PORT", async () => {
      const fetchMock = stubFetchJson({ status: 'success', data: { alerts: [] } });

      await clientWith({ DEV_PROMETHEUS_PORT: '9170' }).alerts();

      expect(requestedUrl(fetchMock).toString()).toBe('http://localhost:9170/api/v1/alerts');
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

      const samples = await clientWith({ PROMETHEUS_URL: 'http://prom.test' }).query('up');

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

      const series = await clientWith({ PROMETHEUS_URL: 'http://prom.test' }).queryRange(
        'rate(x[1m])',
        100,
        160,
        60,
      );

      expect(series).toEqual([
        {
          metric: {},
          values: [
            [100, 1],
            [160, 2],
          ],
        },
      ]);
      const params = requestedUrl(fetchMock).searchParams;
      expect([params.get('start'), params.get('end'), params.get('step')]).toEqual([
        '100',
        '160',
        '60',
      ]);
    });
  });

  describe('alerts', () => {
    it('should return the alert list', async () => {
      const alert = {
        labels: { alertname: 'DlqMessages', severity: 'warning' },
        annotations: { summary: 'DLQ growing' },
        state: 'firing',
        activeAt: '2026-11-18T07:00:00Z',
      };
      stubFetchJson({ status: 'success', data: { alerts: [alert] } });

      const alerts = await clientWith({ PROMETHEUS_URL: 'http://prom.test' }).alerts();

      expect(alerts).toEqual([alert]);
    });
  });

  describe('failures', () => {
    it('should throw PrometheusUnavailableError when the network call fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

      await expect(clientWith({ PROMETHEUS_URL: 'http://prom.test' }).alerts()).rejects.toThrow(
        PrometheusUnavailableError,
      );
    });

    it('should throw PrometheusUnavailableError on a non-2xx status', async () => {
      stubFetchJson({ status: 'error', error: 'bad' }, 503);

      await expect(clientWith({ PROMETHEUS_URL: 'http://prom.test' }).query('up')).rejects.toThrow(
        'Prometheus query returned HTTP 503',
      );
    });

    it('should throw PrometheusUnavailableError when Prometheus reports an error', async () => {
      stubFetchJson({ status: 'error', error: 'parse error' });

      await expect(clientWith({ PROMETHEUS_URL: 'http://prom.test' }).query('up(')).rejects.toThrow(
        'Prometheus query error: parse error',
      );
    });

    it('should throw PrometheusUnavailableError on an unexpected result type', async () => {
      stubFetchJson({ status: 'success', data: { resultType: 'matrix', result: [] } });

      await expect(clientWith({ PROMETHEUS_URL: 'http://prom.test' }).query('up')).rejects.toThrow(
        PrometheusUnavailableError,
      );
    });
  });
});
