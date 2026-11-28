// The Content-Security-Policy every page is served with. It is built per request, because it
// carries the nonce that lets this response's own scripts run. Rule in words:
// docs/frontend.md → "Content security policy".

import { EXTERNAL_CONNECT_ORIGINS } from './external-origins';

export interface PolicyInput {
  /** A fresh random value for this response. */
  nonce: string;
  /** `next dev`: React and Turbopack need `eval` and a WebSocket for hot reload. */
  development: boolean;
  /** Origin of the API, e.g. `https://api.example.com`. */
  apiOrigin: string;
  /** WebSocket origin of the API, e.g. `wss://api.example.com`. */
  apiSocketOrigin: string;
  /** Origins files are uploaded to and read from (presigned links, public branding). */
  fileOrigins: readonly string[];
  /** Web push is configured: the browser registers with the push service. */
  webPush: boolean;
}

const PUSH_ORIGINS = [
  'https://fcmregistrations.googleapis.com',
  'https://firebaseinstallations.googleapis.com',
];

/** The origin of a URL, or null for a value that is not an absolute http(s) or ws(s) URL. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return /^(https?|wss?):$/.test(parsed.protocol) ? `${parsed.protocol}//${parsed.host}` : null;
  } catch {
    return null;
  }
}

/** `ws://host` for `http://host`, `wss://host` for `https://host`. */
export function socketOriginOf(httpOrigin: string): string {
  return httpOrigin.replace(/^http/, 'ws');
}

export function buildContentSecurityPolicy(input: PolicyInput): string {
  const { nonce, development, apiOrigin, apiSocketOrigin, fileOrigins, webPush } = input;
  const files = [...new Set(fileOrigins)];
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    // Script files come from this origin only; an inline script runs only with this response's
    // nonce (Next.js puts it on its own inline scripts, the layout on the theme script). No
    // 'strict-dynamic': Next.js emits some chunk tags without the nonce, and 'self' covers them.
    ['script-src', ["'self'", `'nonce-${nonce}'`, ...(development ? ["'unsafe-eval'"] : [])]],
    // Style sheets come from this origin. Inline styles are allowed as a class, for two things
    // a nonce cannot cover: the `style` attributes React writes for the UI components (computed
    // positions, sizes, colours), and the <style> elements the toast and theme libraries add
    // from script at run time. A nonce here would switch 'unsafe-inline' off.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...files]],
    ['font-src', ["'self'", 'data:']],
    [
      'connect-src',
      [
        "'self'",
        apiOrigin,
        apiSocketOrigin,
        ...files,
        ...EXTERNAL_CONNECT_ORIGINS,
        ...(webPush ? PUSH_ORIGINS : []),
      ],
    ],
    // A generated PDF is shown and downloaded from a blob URL.
    ['frame-src', ["'self'", 'blob:']],
    ['worker-src', ["'self'", 'blob:']],
    ['media-src', ["'self'", 'blob:', ...files]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

/** The policy inputs that come from configuration, read once per process. */
export function policyOriginsFromEnv(env: {
  NEXT_PUBLIC_API_URL?: string;
  NEXT_PUBLIC_WS_URL?: string;
  S3_PUBLIC_ENDPOINT?: string;
  S3_PUBLIC_BASE_URL?: string;
  NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
}): Pick<PolicyInput, 'apiOrigin' | 'apiSocketOrigin' | 'fileOrigins' | 'webPush'> {
  const apiOrigin = originOf(env.NEXT_PUBLIC_API_URL) ?? 'http://localhost:3005';
  return {
    apiOrigin,
    apiSocketOrigin: originOf(env.NEXT_PUBLIC_WS_URL) ?? socketOriginOf(apiOrigin),
    fileOrigins: [originOf(env.S3_PUBLIC_ENDPOINT), originOf(env.S3_PUBLIC_BASE_URL)].filter(
      (origin): origin is string => origin !== null,
    ),
    webPush: Boolean(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  };
}
