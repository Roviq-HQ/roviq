// What leaves the process in logs and traces is decided here (docs/deployment.md → "Telemetry").

const UNTRACED_PATHS = ['/api/health', '/health', '/metrics', '/favicon.ico'];

/** Probes and static noise that get no trace. */
export function isUntracedPath(url: string | undefined): boolean {
  return UNTRACED_PATHS.some((prefix) => url?.startsWith(prefix) ?? false);
}

// A provider that cannot sign its calls is given a secret path instead (the SMS delivery reports).
const SECRET_PATH = /^(\/webhooks\/sms\/)[^/]+/;

function pathOnly(url: string | undefined): string | undefined {
  return url?.split('?', 1)[0]?.replace(SECRET_PATH, '$1[REDACTED]');
}

interface LoggedRequest {
  id?: unknown;
  method?: string;
  url?: string;
}

/** Request line only: headers carry the access token and cookies, a query string may carry a one-time code. */
export function serializeRequest(req: LoggedRequest): {
  id: unknown;
  method: string | undefined;
  url: string | undefined;
} {
  return { id: req.id, method: req.method, url: pathOnly(req.url) };
}

/** Status only: response headers carry `set-cookie`. */
export function serializeResponse(res: { statusCode?: number }): {
  statusCode: number | undefined;
} {
  return { statusCode: res.statusCode };
}

/** Command name only: Redis keys embed Roviq IDs and other identifiers. */
export function serializeRedisCommand(command: string): string {
  return command;
}
