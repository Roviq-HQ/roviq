import { NextResponse } from 'next/server';

const UPSTREAM_TIMEOUT_MS = 8_000;

/** The stream the apps' OTLP exporters write logs and traces to. */
export const OPENOBSERVE_STREAM = 'default';

/** Service names allowed into a query; anything else is refused before SQL or PromQL is built. */
export const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export const MAX_RANGE_SECONDS = 30 * 24 * 60 * 60;

interface OpenObserveConfig {
  baseUrl: string;
  org: string;
  authorization: string;
}

interface OpenObserveRequest {
  /** Path under the base URL, built from the org: `(org) => \`/api/${org}/…\``. */
  path: (org: string) => string;
  search?: URLSearchParams;
  /** JSON body; switches the request to POST. */
  json?: unknown;
}

export type OpenObserveResult =
  | { ok: true; status: number; body: string }
  | { ok: false; response: NextResponse };

export async function openObserveRequest(req: OpenObserveRequest): Promise<OpenObserveResult> {
  const config = readConfig();
  if (!config) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'openobserve not configured',
          detail: 'OPENOBSERVE_USER and OPENOBSERVE_PASSWORD must be set on the web server',
        },
        { status: 502 },
      ),
    };
  }

  const url = new URL(`${config.baseUrl}${req.path(encodeURIComponent(config.org))}`);
  if (req.search) url.search = req.search.toString();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: config.authorization,
  };
  if (req.json !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(url.toString(), {
      method: req.json === undefined ? 'GET' : 'POST',
      headers,
      body: req.json === undefined ? undefined : JSON.stringify(req.json),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return { ok: true, status: res.status, body: await res.text() };
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'openobserve unreachable',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      ),
    };
  }
}

/** Forwards the upstream body and status unchanged. */
export async function proxyOpenObserve(req: OpenObserveRequest): Promise<NextResponse> {
  const result = await openObserveRequest(req);
  if (!result.ok) return result.response;
  return new NextResponse(result.body, {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Runs one SQL search on the logs or traces stream; `sql` must be built from validated input only. */
export function searchOpenObserve(args: {
  type: 'logs' | 'traces';
  sql: string;
  sinceSeconds: number;
  size: number;
}): Promise<NextResponse> {
  const endUs = Date.now() * 1_000;
  return proxyOpenObserve({
    path: (org) => `/api/${org}/_search`,
    search: new URLSearchParams({ type: args.type }),
    json: {
      query: {
        sql: args.sql,
        start_time: endUs - args.sinceSeconds * 1_000_000,
        end_time: endUs,
        from: 0,
        size: args.size,
      },
    },
  });
}

/** Parses an integer query parameter, falling back on bad input and clamping to [min, max]. */
export function clampInt(
  raw: string | null,
  { fallback, min, max }: { fallback: number; min: number; max: number },
): number {
  const parsed = Number(raw ?? fallback);
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.min(Math.max(value, min), max);
}

/**
 * Reads the comma-separated `services` parameter. Returns null when any name fails
 * the allowlist, so the caller answers 400 instead of silently widening the query.
 */
export function parseServiceNames(raw: string | null): string[] | null {
  if (!raw) return [];
  const names = raw.split(',').filter((s) => s.length > 0);
  return names.every((s) => SERVICE_NAME_PATTERN.test(s)) ? names : null;
}

/** `service_name IN ('a', 'b')`; names must already have passed `parseServiceNames`. */
export function serviceNameInClause(names: readonly string[]): string {
  return `service_name IN (${names.map((n) => `'${n}'`).join(', ')})`;
}

function readConfig(): OpenObserveConfig | null {
  const user = process.env.OPENOBSERVE_USER;
  const password = process.env.OPENOBSERVE_PASSWORD;
  if (!user || !password) return null;
  const baseUrl =
    process.env.OPENOBSERVE_URL ?? `http://localhost:${process.env.DEV_OPENOBSERVE_PORT ?? '5080'}`;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    org: process.env.OPENOBSERVE_ORG ?? 'default',
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
  };
}
