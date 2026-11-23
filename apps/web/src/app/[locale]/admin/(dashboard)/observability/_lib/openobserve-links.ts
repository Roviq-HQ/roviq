// The org and stream the apps' OTLP exporters write to.
const ORG = 'default';
const STREAM = 'default';

export type OpenObserveSection = 'logs' | 'metrics' | 'traces';

export function openObserveSectionUrl(base: string, section: OpenObserveSection): string {
  const params = new URLSearchParams({ org_identifier: ORG });
  if (section !== 'metrics') {
    params.set('stream_type', section);
    params.set('stream', STREAM);
  }
  return `${base}/web/${section}?${params}`;
}

/**
 * Opens the metrics Visualize screen with the PromQL prefilled. OpenObserve needs the
 * metric stream named in the blob, or it charts its first stream instead; when the
 * query names no metric selector the section page is the honest fallback.
 */
export function openObserveMetricsUrl(base: string, promQuery: string): string {
  const stream = firstMetricName(promQuery);
  if (!stream) return openObserveSectionUrl(base, 'metrics');
  const blob = {
    v: 1,
    data: {
      version: 5,
      type: 'line',
      queryType: 'promql',
      queries: [
        {
          query: promQuery,
          customQuery: true,
          fields: { stream, stream_type: 'metrics' },
          config: { query_type: 'range' },
        },
      ],
    },
  };
  // OpenObserve's encoding: standard base64 with '=' padding written as '.'.
  const encoded = btoa(JSON.stringify(blob)).replace(/=/g, '.');
  const params = new URLSearchParams({
    org_identifier: ORG,
    mode: 'visualize',
    metrics_data: encoded,
  });
  return `${base}/web/metrics?${params}`;
}

/** One trace's waterfall; the window must contain the trace or OpenObserve shows nothing. */
export function openObserveTraceUrl(base: string, traceId: string, startedAtUs: number): string {
  const marginUs = 60 * 60 * 1_000_000;
  const params = new URLSearchParams({
    stream: STREAM,
    trace_id: traceId,
    from: String(startedAtUs - marginUs),
    to: String(startedAtUs + marginUs),
    org_identifier: ORG,
  });
  return `${base}/web/traces/trace-details?${params}`;
}

export function firstMetricName(promQuery: string): string | null {
  return /([a-zA-Z_:][a-zA-Z0-9_:]*)\s*[{[]/.exec(promQuery)?.[1] ?? null;
}
