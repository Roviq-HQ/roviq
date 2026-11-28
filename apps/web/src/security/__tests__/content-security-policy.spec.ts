// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { securityHeaders } from '../../../security-headers';
import {
  buildContentSecurityPolicy,
  originOf,
  type PolicyInput,
  policyOriginsFromEnv,
} from '../content-security-policy';

const INPUT: PolicyInput = {
  nonce: 'bm9uY2U=',
  development: false,
  apiOrigin: 'https://api.example.test',
  apiSocketOrigin: 'wss://api.example.test',
  fileOrigins: ['https://files.example.test'],
  webPush: false,
};

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );
}

describe('buildContentSecurityPolicy', () => {
  it('should let scripts run from this origin and with the nonce only, in production', () => {
    const policy = directives(buildContentSecurityPolicy(INPUT));

    expect(policy['script-src']).toEqual(["'self'", "'nonce-bm9uY2U='"]);
    expect(policy['default-src']).toEqual(["'self'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
  });

  it('should add eval for scripts in development only', () => {
    const dev = directives(buildContentSecurityPolicy({ ...INPUT, development: true }));

    expect(dev['script-src']).toEqual(["'self'", "'nonce-bm9uY2U='", "'unsafe-eval'"]);
    expect(buildContentSecurityPolicy(INPUT)).not.toContain('unsafe-eval');
  });

  it('should never allow inline scripts as a class, nor any host for scripts', () => {
    for (const development of [true, false]) {
      const scripts = directives(buildContentSecurityPolicy({ ...INPUT, development }))[
        'script-src'
      ];
      expect(scripts).not.toContain("'unsafe-inline'");
      expect(scripts?.filter((source) => /^(https?:|\*)/.test(source))).toEqual([]);
    }
  });

  it('should connect to this origin, the API over HTTP and WebSocket, and the file store', () => {
    const policy = directives(buildContentSecurityPolicy(INPUT));

    expect(policy['connect-src']).toEqual([
      "'self'",
      'https://api.example.test',
      'wss://api.example.test',
      'https://files.example.test',
      // The PIN code directory the address forms call.
      'https://api.postalpincode.in',
    ]);
    expect(policy['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://files.example.test']);
  });

  it('should add the push service only when web push is configured', () => {
    const withPush = directives(buildContentSecurityPolicy({ ...INPUT, webPush: true }));

    expect(withPush['connect-src']).toContain('https://fcmregistrations.googleapis.com');
    expect(buildContentSecurityPolicy(INPUT)).not.toContain('googleapis');
  });

  it('should list a file origin once when both settings name the same one', () => {
    const policy = directives(
      buildContentSecurityPolicy({
        ...INPUT,
        fileOrigins: ['https://files.example.test', 'https://files.example.test'],
      }),
    );

    expect(policy['img-src']?.filter((s) => s === 'https://files.example.test')).toHaveLength(1);
  });
});

describe('policyOriginsFromEnv', () => {
  it('should take origins from the public configuration, dropping paths', () => {
    expect(
      policyOriginsFromEnv({
        NEXT_PUBLIC_API_URL: 'https://api.example.test/api',
        S3_PUBLIC_ENDPOINT: 'https://files.example.test',
        S3_PUBLIC_BASE_URL: 'https://cdn.example.test/roviq-public',
      }),
    ).toEqual({
      apiOrigin: 'https://api.example.test',
      apiSocketOrigin: 'wss://api.example.test',
      fileOrigins: ['https://files.example.test', 'https://cdn.example.test'],
      webPush: false,
    });
  });

  it('should fall back to the local API and no file origin when nothing is set', () => {
    expect(policyOriginsFromEnv({})).toEqual({
      apiOrigin: 'http://localhost:3005',
      apiSocketOrigin: 'ws://localhost:3005',
      fileOrigins: [],
      webPush: false,
    });
  });

  it('should ignore a value that is not an absolute URL', () => {
    expect(originOf('files.example.test')).toBeNull();
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});

describe('securityHeaders', () => {
  const names = (production: boolean) => securityHeaders({ production }).map((h) => h.key);

  it('should send HSTS in production only', () => {
    expect(names(true)).toContain('Strict-Transport-Security');
    expect(names(false)).not.toContain('Strict-Transport-Security');
  });

  it('should refuse framing and sniffing, and isolate the page and its resources', () => {
    const headers = Object.fromEntries(
      securityHeaders({ production: true }).map((h) => [h.key, h.value]),
    );

    expect(headers).toMatchObject({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
  });
});
