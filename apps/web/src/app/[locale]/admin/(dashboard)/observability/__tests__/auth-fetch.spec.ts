import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from '../_lib/auth-fetch';

interface Sent {
  url: string;
  headers: Headers;
  body: { query: string; variables: Record<string, unknown> };
}

let sent: Sent[];
let answer: () => Response;

beforeEach(() => {
  sent = [];
  answer = () => Response.json({ data: {} });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
      return answer();
    }),
  );
  sessionStorage.setItem('roviq-platform-access-token', 'token-1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('authFetch', () => {
  it('should ask the API gateway for logs with the platform token and typed variables', async () => {
    answer = () => Response.json({ data: { adminObservabilityLogs: { hits: [{ body: 'x' }] } } });

    const res = await authFetch('/api/logs?services=api-gateway,web&limit=20&sinceSeconds=900');

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toMatch(/\/api\/graphql$/);
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer token-1');
    expect(sent[0]?.body.query).toContain('adminObservabilityLogs');
    expect(sent[0]?.body.variables).toEqual({
      services: ['api-gateway', 'web'],
      limit: 20,
      sinceSeconds: 900,
    });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ hits: [{ body: 'x' }] });
  });

  it('should send a metrics read with its endpoint and range', async () => {
    answer = () => Response.json({ data: { adminObservabilityMetrics: { status: 'success' } } });

    const res = await authFetch(
      '/api/metrics?endpoint=query_range&query=up&step=30&start=10&end=70',
    );

    expect(sent[0]?.body.variables).toEqual({
      query: 'up',
      endpoint: 'query_range',
      step: 30,
      start: 10,
      end: 70,
    });
    expect(await res.json()).toEqual({ status: 'success' });
  });

  it('should answer a failed read as a non-2xx response with the reason', async () => {
    answer = () =>
      Response.json({
        data: null,
        errors: [
          { message: 'OpenObserve is down', extensions: { code: 'OBSERVABILITY_UNAVAILABLE' } },
        ],
      });

    const res = await authFetch('/api/alerts');

    expect(res.ok).toBe(false);
    expect(await res.json()).toEqual({ error: 'OpenObserve is down' });
  });

  it('should refuse a resource it does not know without asking the API', async () => {
    const res = await authFetch('/api/secrets');

    expect(res.status).toBe(404);
    expect(sent).toHaveLength(0);
  });
});
