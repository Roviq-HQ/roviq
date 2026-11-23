import { describe, expect, it } from 'vitest';
import {
  firstMetricName,
  openObserveMetricsUrl,
  openObserveSectionUrl,
  openObserveTraceUrl,
} from '../_lib/openobserve-links';
import { buildLatencyUnion, buildQueries } from '../_lib/prom';

const BASE = 'http://localhost:5080';

describe('OpenObserve links', () => {
  it('should name the metric stream of every dashboard query', () => {
    const queries = buildQueries([]);

    expect(firstMetricName(queries.requestRate)).toBe('http_server_duration_count');
    expect(firstMetricName(buildLatencyUnion(queries))).toBe('http_server_duration_bucket');
    expect(firstMetricName(queries.eventBusFailed)).toBe('event_bus_emit_failed_total');
  });

  it('should prefill the PromQL on the metrics Visualize screen', () => {
    const url = new URL(openObserveMetricsUrl(BASE, 'sum(rate(http_server_duration_count[1m]))'));

    expect(url.pathname).toBe('/web/metrics');
    expect(url.searchParams.get('mode')).toBe('visualize');
    const blob = url.searchParams.get('metrics_data') ?? '';
    expect(JSON.parse(atob(blob.replace(/\./g, '=')))).toEqual({
      v: 1,
      data: {
        version: 5,
        type: 'line',
        queryType: 'promql',
        queries: [
          {
            query: 'sum(rate(http_server_duration_count[1m]))',
            customQuery: true,
            fields: { stream: 'http_server_duration_count', stream_type: 'metrics' },
            config: { query_type: 'range' },
          },
        ],
      },
    });
  });

  it('should fall back to the metrics page when the query names no selector', () => {
    expect(openObserveMetricsUrl(BASE, 'vector(1)')).toBe(
      `${BASE}/web/metrics?org_identifier=default`,
    );
  });

  it('should open the logs stream page', () => {
    expect(openObserveSectionUrl(BASE, 'logs')).toBe(
      `${BASE}/web/logs?org_identifier=default&stream_type=logs&stream=default`,
    );
  });

  it('should open one trace with a window around its start', () => {
    expect(openObserveTraceUrl(BASE, 'abc123', 10_000_000_000)).toBe(
      `${BASE}/web/traces/trace-details?stream=default&trace_id=abc123&from=6400000000&to=13600000000&org_identifier=default`,
    );
  });

  it('should drop service names that fail the allowlist from the PromQL selector', () => {
    expect(buildQueries(['api-gateway', 'x"}) or vector(1']).totalRequests).toBe(
      'sum(http_server_duration_count{service_name=~"api-gateway"}) or vector(0)',
    );
  });
});
