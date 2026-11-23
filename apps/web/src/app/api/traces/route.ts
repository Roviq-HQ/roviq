import { NextResponse } from 'next/server';
import { requireAdminAuth } from '../_lib/admin-auth';
import {
  clampInt,
  MAX_RANGE_SECONDS,
  OPENOBSERVE_STREAM,
  parseServiceNames,
  searchOpenObserve,
  serviceNameInClause,
} from '../_lib/openobserve';

const MAX_LIMIT = 100;

// OTLP span kinds as OpenObserve stores them: '2' server, '5' consumer (incoming work).
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

export async function GET(request: Request) {
  const denied = requireAdminAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const services = parseServiceNames(url.searchParams.get('services'));
  if (!services) {
    return NextResponse.json({ error: 'invalid service name' }, { status: 400 });
  }
  const limit = clampInt(url.searchParams.get('limit'), { fallback: 20, min: 1, max: MAX_LIMIT });
  const sinceSeconds = clampInt(url.searchParams.get('sinceSeconds'), {
    fallback: 3600,
    min: 1,
    max: MAX_RANGE_SECONDS,
  });

  const filters =
    services.length > 0 ? [...ROOT_SPAN_FILTERS, serviceNameInClause(services)] : ROOT_SPAN_FILTERS;
  const sql = `SELECT _timestamp, trace_id, service_name, operation_name, duration FROM "${OPENOBSERVE_STREAM}" WHERE ${filters.join(' AND ')} ORDER BY _timestamp DESC`;

  return searchOpenObserve({ type: 'traces', sql, sinceSeconds, size: limit });
}
