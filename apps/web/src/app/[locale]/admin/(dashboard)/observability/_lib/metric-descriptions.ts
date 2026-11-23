// Single source of truth for what every observability panel actually shows.

export interface MetricDescription {
  /** Short title used as the panel header. */
  title: string;
  /** What this panel actually plots. Shown as `(i)` tooltip — keep ≤ 240 chars. */
  description: string;
}

export const METRIC_INFO = {
  requestRate: {
    title: 'Request Rate',
    description:
      'HTTP requests per second handled by the api-gateway, split by method + route. Use this to see current load and spot traffic bursts.',
  },
  errorRate5xx: {
    title: 'Error Rate (5xx)',
    description:
      'Per-second rate of HTTP 5xx responses. Should normally be 0 — anything sustained above zero means the api-gateway is returning server errors.',
  },
  latencyQuantiles: {
    title: 'Latency — p50 / p95 / p99',
    description:
      'Histogram quantiles of HTTP response time in milliseconds. p50 = typical, p95 = slow requests, p99 = worst outlier. Watch for tail latency before users do.',
  },
  totalRequests: {
    title: 'Total Requests',
    description:
      'Cumulative HTTP request count since the api-gateway last started. Always increasing — handy for raw throughput, not for current load (use Request Rate for that).',
  },
  totalRequests5m: {
    title: 'Total Requests (last 5m)',
    description:
      'Number of HTTP requests handled in the last 5 minutes. Equivalent to Request Rate × 300, presented as a count for easier mental math.',
  },
  errorPct: {
    title: 'Error Rate %',
    description:
      '5xx responses as a percent of all responses over the last 5 minutes. Green <1%, yellow 1–5%, red >5% — the standard SLO comparison.',
  },
  avgResponseMs: {
    title: 'Avg Response Time',
    description:
      'Mean HTTP response time over the last 5 minutes (sum / count, in ms). A blunt metric — for distribution, use the Latency p50/p95/p99 panel.',
  },
  eventBusEmit: {
    title: 'EventBus emit rate (by subject_prefix)',
    description:
      'Per-second rate of NATS events published via EventBusService.emit(), grouped by subject prefix (RESELLER, INSTITUTE, NOTIFICATION, …). One line per active prefix.',
  },
  eventBusFailed: {
    title: 'EventBus emit FAILURES (by subject_prefix)',
    description:
      'Per-second rate of EventBusService.emit() calls where the NATS publish errored. Should normally be 0. Sustained failures = NATS down, stream-config drift, or consumer overload.',
  },
  jetstreamStreams: {
    title: 'JetStream Streams',
    description:
      'Live per-stream stats the api-gateway reads from NATS JetStream: message count, bytes used, consumer count, pending deliveries. Green = healthy (no pending), amber = some pending, red = redelivers or pending >100.',
  },
  recentTraces: {
    title: 'Recent Traces',
    description:
      'Most recent incoming requests and events traced by OpenTelemetry, excluding noise (Docker healthchecks, codegen introspection, /api/health). Click a trace to inspect its spans in OpenObserve.',
  },
  recentLogs: {
    title: 'Recent Logs',
    description:
      'Most recent log lines the services export to OpenObserve over OTLP, with level, service and message. Empty when no service has logged in this range.',
  },
} as const;

export type MetricInfoKey = keyof typeof METRIC_INFO;
