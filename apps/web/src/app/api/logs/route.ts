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

const MAX_LIMIT = 500;

export async function GET(request: Request) {
  const denied = requireAdminAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const services = parseServiceNames(url.searchParams.get('services'));
  if (!services) {
    return NextResponse.json({ error: 'invalid service name' }, { status: 400 });
  }
  const limit = clampInt(url.searchParams.get('limit'), { fallback: 50, min: 1, max: MAX_LIMIT });
  const sinceSeconds = clampInt(url.searchParams.get('sinceSeconds'), {
    fallback: 3600,
    min: 1,
    max: MAX_RANGE_SECONDS,
  });

  const where = services.length > 0 ? ` WHERE ${serviceNameInClause(services)}` : '';
  const sql = `SELECT _timestamp, severity, service_name, body FROM "${OPENOBSERVE_STREAM}"${where} ORDER BY _timestamp DESC`;

  return searchOpenObserve({ type: 'logs', sql, sinceSeconds, size: limit });
}
