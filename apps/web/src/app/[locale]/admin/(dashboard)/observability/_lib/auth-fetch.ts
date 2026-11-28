// Browser-side helpers used by every observability read. The pages ask the API gateway,
// which holds the telemetry store's credential and checks the platform scope; `authFetch`
// keeps the small fetch-like shape the panels were written against.
// `errMessage` is the project-standard `unknown → string` formatter; it
// avoids the [NTESC] `as Error` escape hatch.

const PLATFORM_TOKEN_KEY = 'roviq-platform-access-token';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005';

type Variables = Record<string, string | number | string[]>;

interface Operation {
  field: string;
  document: string;
  variables: (params: URLSearchParams) => Variables;
}

function intParam(params: URLSearchParams, name: string, into: Variables): void {
  const raw = params.get(name);
  if (raw === null) return;
  const value = Number(raw);
  if (Number.isFinite(value)) into[name] = Math.floor(value);
}

function searchVariables(params: URLSearchParams): Variables {
  const variables: Variables = {};
  const services = params.get('services');
  if (services) variables.services = services.split(',').filter((s) => s.length > 0);
  intParam(params, 'limit', variables);
  intParam(params, 'sinceSeconds', variables);
  return variables;
}

const OPERATIONS: Readonly<Record<string, Operation>> = {
  '/api/logs': {
    field: 'adminObservabilityLogs',
    document:
      'query ObservabilityLogs($services: [String!], $limit: Int, $sinceSeconds: Int) { adminObservabilityLogs(services: $services, limit: $limit, sinceSeconds: $sinceSeconds) }',
    variables: searchVariables,
  },
  '/api/traces': {
    field: 'adminObservabilityTraces',
    document:
      'query ObservabilityTraces($services: [String!], $limit: Int, $sinceSeconds: Int) { adminObservabilityTraces(services: $services, limit: $limit, sinceSeconds: $sinceSeconds) }',
    variables: searchVariables,
  },
  '/api/metrics': {
    field: 'adminObservabilityMetrics',
    document:
      'query ObservabilityMetrics($query: String!, $endpoint: String, $step: Int, $start: Int, $end: Int) { adminObservabilityMetrics(query: $query, endpoint: $endpoint, step: $step, start: $start, end: $end) }',
    variables: (params) => {
      const variables: Variables = { query: params.get('query') ?? '' };
      const endpoint = params.get('endpoint');
      if (endpoint) variables.endpoint = endpoint;
      intParam(params, 'step', variables);
      intParam(params, 'start', variables);
      intParam(params, 'end', variables);
      return variables;
    },
  },
  '/api/alerts': {
    field: 'adminObservabilityAlerts',
    document: 'query ObservabilityAlerts { adminObservabilityAlerts }',
    variables: () => ({}),
  },
};

function getPlatformToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(PLATFORM_TOKEN_KEY);
  } catch {
    return null;
  }
}

interface GraphQLAnswer {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}

function isAnswer(value: unknown): value is GraphQLAnswer {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads one observability resource, named as `/api/logs`, `/api/traces`, `/api/metrics` or
 * `/api/alerts` with its query string, and answers a `Response` whose JSON is the resource.
 * A refused or failed read answers a non-2xx `Response` with `{ error }`.
 */
export async function authFetch(input: string): Promise<Response> {
  const [path, search = ''] = input.split('?');
  const operation = OPERATIONS[path ?? ''];
  if (!operation) return Response.json({ error: `unknown resource ${path}` }, { status: 404 });

  const token = getPlatformToken();
  const res = await fetch(`${API_URL}/api/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query: operation.document,
      variables: operation.variables(new URLSearchParams(search)),
    }),
    cache: 'no-store',
  });
  const answer: unknown = await res.json().catch(() => null);
  if (!isAnswer(answer)) {
    return Response.json(
      { error: `observability read failed (HTTP ${res.status})` },
      { status: 502 },
    );
  }
  const failure = answer.errors?.[0];
  if (failure) {
    return Response.json(
      { error: failure.message ?? failure.extensions?.code ?? 'observability read failed' },
      { status: res.ok ? 502 : res.status },
    );
  }
  return Response.json(answer.data?.[operation.field] ?? null);
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Service-name allowlist for the PromQL label selectors built in the browser.
 * Names come from URL state; the API checks the same pattern again before it builds a query.
 */
export function sanitizeServiceNames(names: readonly string[]): string[] {
  return names.filter((s) => /^[a-zA-Z0-9_.-]+$/.test(s));
}
