import { NextResponse } from 'next/server';
import { requireAdminAuth } from '../_lib/admin-auth';
import { proxyOpenObserve } from '../_lib/openobserve';

const ALLOWED_ENDPOINTS = new Set(['query', 'query_range']);

// Bounds so a hostile or buggy caller cannot ask for millions of data points. 86400 step = 1 sample per day.
const MIN_STEP_SECONDS = 5;
const MAX_STEP_SECONDS = 86_400;
const MAX_RANGE_SECONDS = 30 * 24 * 60 * 60;

export async function GET(request: Request) {
  const denied = requireAdminAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint') ?? 'query_range';
  const query = url.searchParams.get('query');

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json(
      { error: `endpoint must be one of ${[...ALLOWED_ENDPOINTS].join(', ')}` },
      { status: 400 },
    );
  }
  if (!query) {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }

  const search = new URLSearchParams({ query });

  if (endpoint === 'query_range') {
    const now = Math.floor(Date.now() / 1000);
    const rawStep = Number(url.searchParams.get('step') ?? '30');
    const rawStart = Number(url.searchParams.get('start') ?? String(now - 3600));
    const rawEnd = Number(url.searchParams.get('end') ?? String(now));

    if (!Number.isFinite(rawStep) || !Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      return NextResponse.json(
        { error: 'step, start, end must be finite numbers' },
        { status: 400 },
      );
    }

    const step = Math.min(Math.max(Math.floor(rawStep), MIN_STEP_SECONDS), MAX_STEP_SECONDS);
    const end = Math.floor(rawEnd);
    const start = Math.max(Math.floor(rawStart), end - MAX_RANGE_SECONDS);
    if (start >= end) {
      return NextResponse.json({ error: 'start must be < end' }, { status: 400 });
    }

    search.set('step', String(step));
    search.set('start', String(start));
    search.set('end', String(end));
  }

  return proxyOpenObserve({
    path: (org) => `/api/${org}/prometheus/api/v1/${endpoint}`,
    search,
  });
}
