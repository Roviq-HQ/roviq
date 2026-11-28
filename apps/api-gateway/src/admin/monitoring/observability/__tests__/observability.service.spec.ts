import { ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { type OpenObserveClient, OpenObserveUnavailableError } from '../../openobserve.client';
import { ObservabilityService } from '../observability.service';

function setup(overrides: Partial<OpenObserveClient> = {}) {
  const client = createMock<OpenObserveClient>({
    search: vi.fn().mockResolvedValue({ hits: [] }),
    prometheus: vi.fn().mockResolvedValue({ status: 'success', data: { result: [] } }),
    alerts: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
  return { client, service: new ObservabilityService(client) };
}

describe('ObservabilityService', () => {
  describe('logs', () => {
    it('should search the logs stream with the defaults when nothing is asked', async () => {
      const { client, service } = setup();

      await service.logs({});

      expect(client.search).toHaveBeenCalledWith({
        type: 'logs',
        sql: 'SELECT _timestamp, severity, service_name, body FROM "default" ORDER BY _timestamp DESC',
        sinceSeconds: 3600,
        size: 50,
      });
    });

    it('should filter by the named services and clamp the page and the window', async () => {
      const { client, service } = setup();

      await service.logs({
        services: ['api-gateway', 'web'],
        limit: 10_000,
        sinceSeconds: 90 * 24 * 3600,
      });

      expect(client.search).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("WHERE service_name IN ('api-gateway', 'web')"),
          size: 500,
          sinceSeconds: 30 * 24 * 3600,
        }),
      );
    });

    it.each([
      ["a' OR '1'='1"],
      ['web; DROP'],
      ['a"b'],
      ['with space'],
    ])('should refuse the service name %j before any query is built', async (name) => {
      const { client, service } = setup();

      expect(() => service.logs({ services: ['web', name] })).toThrow(
        expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }),
      );
      expect(client.search).not.toHaveBeenCalled();
    });
  });

  describe('traces', () => {
    it('should read root spans only, at most 100', async () => {
      const { client, service } = setup();

      await service.traces({ services: ['api-gateway'], limit: 5000 });

      const call = vi.mocked(client.search).mock.calls[0]?.[0];
      expect(call).toMatchObject({ type: 'traces', size: 100, sinceSeconds: 3600 });
      expect(call?.sql).toContain("span_kind IN ('2', '5')");
      expect(call?.sql).toContain("service_name IN ('api-gateway')");
    });
  });

  describe('metrics', () => {
    it('should send an instant query with the expression only', async () => {
      const { client, service } = setup();

      await service.metrics({ endpoint: 'query', query: 'up', step: 1, start: 5, end: 9 });

      expect(client.prometheus).toHaveBeenCalledWith('query', { query: 'up' });
    });

    it('should clamp the step and keep the window within 30 days', async () => {
      const { client, service } = setup();
      const end = 2_000_000_000;

      await service.metrics({ endpoint: 'query_range', query: 'up', step: 1, start: 0, end });

      expect(client.prometheus).toHaveBeenCalledWith('query_range', {
        query: 'up',
        step: '5',
        start: String(end - 30 * 24 * 3600),
        end: String(end),
      });
    });

    it('should refuse an empty expression and an empty window', () => {
      const { client, service } = setup();

      expect(() => service.metrics({ endpoint: 'query', query: '  ' })).toThrow(
        expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }),
      );
      expect(() =>
        service.metrics({ endpoint: 'query_range', query: 'up', start: 100, end: 100 }),
      ).toThrow(expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }));
      expect(client.prometheus).not.toHaveBeenCalled();
    });
  });

  describe('alerts', () => {
    it('should answer the banner fields only, without a rule’s query', async () => {
      const { service } = setup({
        alerts: vi.fn().mockResolvedValue([
          {
            labels: { alertname: 'high_error_rate', severity: 'critical' },
            annotations: { summary: 'Too many errors' },
            state: 'firing',
            activeAt: '2026-11-28T10:00:00.000Z',
            condition: { promql: 'sum(rate(errors[5m]))', operator: '>', value: 1 },
          },
        ]),
      });

      expect(await service.alerts()).toEqual({
        status: 'success',
        data: {
          alerts: [
            {
              labels: { alertname: 'high_error_rate', severity: 'critical' },
              annotations: { summary: 'Too many errors' },
              state: 'firing',
              activeAt: '2026-11-28T10:00:00.000Z',
            },
          ],
        },
      });
    });
  });

  it('should answer OBSERVABILITY_UNAVAILABLE when the store cannot be read', async () => {
    const { service } = setup({
      search: vi.fn().mockRejectedValue(new OpenObserveUnavailableError('down')),
    });

    await expect(service.logs({})).rejects.toMatchObject({
      code: ErrorCode.OBSERVABILITY_UNAVAILABLE,
    });
  });
});
