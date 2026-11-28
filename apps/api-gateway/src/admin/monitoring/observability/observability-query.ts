// Builds the queries the observability pages send to the telemetry store, from validated
// input only: a service name is checked against a pattern before it reaches SQL, and a time
// range or a page size is clamped.

/** The stream the apps' OTLP exporters write logs and traces to. */
export const OPENOBSERVE_STREAM = 'default';

/** Service names allowed into a query; anything else is refused before SQL is built. */
export const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export const MAX_RANGE_SECONDS = 30 * 24 * 60 * 60;
export const MAX_LOG_LINES = 500;
export const MAX_TRACES = 100;

const MIN_STEP_SECONDS = 5;
// One sample per day.
const MAX_STEP_SECONDS = 86_400;

export const METRIC_ENDPOINTS = ['query', 'query_range'] as const;
export type MetricEndpoint = (typeof METRIC_ENDPOINTS)[number];

// OTLP span kinds as the store keeps them: '2' server, '5' consumer (incoming work).
const ROOT_SPAN_FILTERS = [
  "(reference_parent_span_id IS NULL OR reference_parent_span_id = '')",
  "span_kind IN ('2', '5')",
  // Docker health checks, the gateway's own health probe and codegen introspection crowd out real traffic.
  "service_name <> 'compose'",
  "operation_name NOT LIKE 'GET /api/health%'",
  "operation_name <> 'HEAD /_ping'",
  // Introspection is a child span of an ordinary `POST /api/graphql` root.
  `trace_id NOT IN (SELECT trace_id FROM "${OPENOBSERVE_STREAM}" WHERE operation_name = 'query IntrospectionQuery')`,
];

/** An integer within [min, max]; `fallback` when the value is missing or not a number. */
export function clampInt(
  raw: number | null | undefined,
  { fallback, min, max }: { fallback: number; min: number; max: number },
): number {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : fallback;
  return Math.min(Math.max(value, min), max);
}

/** True when every name may be put into a query. */
export function areServiceNames(names: readonly string[]): boolean {
  return names.every((name) => SERVICE_NAME_PATTERN.test(name));
}

/** `service_name IN ('a', 'b')`; the names must have passed `areServiceNames`. */
function serviceNameInClause(names: readonly string[]): string {
  return `service_name IN (${names.map((n) => `'${n}'`).join(', ')})`;
}

export function logsSql(services: readonly string[]): string {
  const where = services.length > 0 ? ` WHERE ${serviceNameInClause(services)}` : '';
  return `SELECT _timestamp, severity, service_name, body FROM "${OPENOBSERVE_STREAM}"${where} ORDER BY _timestamp DESC`;
}

export function tracesSql(services: readonly string[]): string {
  const filters =
    services.length > 0 ? [...ROOT_SPAN_FILTERS, serviceNameInClause(services)] : ROOT_SPAN_FILTERS;
  return `SELECT _timestamp, trace_id, service_name, operation_name, duration FROM "${OPENOBSERVE_STREAM}" WHERE ${filters.join(' AND ')} ORDER BY _timestamp DESC`;
}

export interface MetricRange {
  step: number;
  start: number;
  end: number;
}

/**
 * The step and window of a range query, clamped so that no caller can ask for millions of
 * points. Null when the window is empty.
 */
export function metricRange(
  input: { step?: number | null; start?: number | null; end?: number | null },
  nowSec: number,
): MetricRange | null {
  const end = Math.floor(input.end ?? nowSec);
  const step = clampInt(input.step, { fallback: 30, min: MIN_STEP_SECONDS, max: MAX_STEP_SECONDS });
  const start = Math.max(Math.floor(input.start ?? nowSec - 3600), end - MAX_RANGE_SECONDS);
  return start < end ? { step, start, end } : null;
}
