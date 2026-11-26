import { z } from 'zod';

const HEX_KEY = /^[0-9a-fA-F]{64}$/;
/** Used outside production when the key is unset; production refuses it. */
export const DEV_MESSAGING_ENCRYPTION_KEY = '0'.repeat(64);

const envSchema = z
  .looseObject({
    // Database
    DATABASE_URL: z.string({
      error:
        'DATABASE_URL — PostgreSQL connection string for the pooler role (roviq_pooler, assumes roles via SET LOCAL ROLE)',
    }),

    // Redis
    REDIS_URL: z.string({
      error: 'REDIS_URL — Redis connection URL (e.g. redis://localhost:6379)',
    }),

    // NATS
    NATS_URL: z.string({
      error: 'NATS_URL — NATS server URL for event streaming (e.g. nats://localhost:4222)',
    }),

    // Object storage (S3-compatible)
    S3_ENDPOINT: z.url({
      error: 'S3_ENDPOINT — object storage endpoint the server uses (e.g. http://localhost:9002)',
    }),
    S3_PUBLIC_ENDPOINT: z.url({
      error:
        'S3_PUBLIC_ENDPOINT — object storage endpoint the browser can reach; presigned URLs are signed for it',
    }),
    S3_REGION: z.string({ error: 'S3_REGION — object storage region (e.g. us-east-1)' }),
    S3_ACCESS_KEY: z.string({ error: 'S3_ACCESS_KEY — object storage access key' }),
    S3_SECRET_KEY: z.string({ error: 'S3_SECRET_KEY — object storage secret key' }),
    S3_BUCKET_PRIVATE: z.string({
      error: 'S3_BUCKET_PRIVATE — bucket for files served through signed URLs (e.g. roviq-private)',
    }),
    S3_BUCKET_PUBLIC: z.string({
      error: 'S3_BUCKET_PUBLIC — bucket for files readable without sign-in (e.g. roviq-public)',
    }),
    S3_PUBLIC_BASE_URL: z.url({
      error:
        'S3_PUBLIC_BASE_URL — stable base URL of the public bucket (e.g. http://localhost:9002/roviq-public)',
    }),

    // JWT
    JWT_SECRET: z.string({
      error: 'JWT_SECRET — signing key for access tokens',
    }),
    JWT_REFRESH_SECRET: z.string({
      error: 'JWT_REFRESH_SECRET — signing key for refresh tokens (must differ from JWT_SECRET)',
    }),

    // Messaging sender access tokens are encrypted with this key (ROV-319)
    MESSAGING_ENCRYPTION_KEY: z
      .string()
      .regex(HEX_KEY, {
        error:
          'MESSAGING_ENCRYPTION_KEY — must be 64 hex characters (32 bytes); generate with: openssl rand -hex 32',
      })
      .optional(),

    // WebAuthn / Passkey
    WEBAUTHN_RP_ID: z.string({
      error: 'WEBAUTHN_RP_ID — relying party identifier, typically the domain (e.g. localhost)',
    }),
    WEBAUTHN_RP_NAME: z.string({
      error: 'WEBAUTHN_RP_NAME — relying party display name (e.g. Roviq)',
    }),
    ALLOWED_ORIGINS: z.string({
      error:
        'ALLOWED_ORIGINS — comma-separated allowed origins for CORS and WebAuthn (e.g. http://localhost:4200)',
    }),

    // Optional
    NODE_ENV: z.string().optional(),
    API_GATEWAY_PORT: z.coerce.number().optional(),
    LOG_LEVEL: z.string().optional(),
    JWT_EXPIRATION: z.string().optional(),
    JWT_REFRESH_EXPIRATION: z.string().optional(),
    ROVIQ_EE: z.string().optional(),
    NOTIFICATION_SERVICE_URL: z.string().optional(),
    BILLING_RETURN_URL: z.url().optional(),
    // Malware scanner for uploads; unset means off in production, eicar elsewhere (ROV-303)
    FILE_SCANNER: z.enum(['clamav', 'eicar', 'off']).optional(),
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().optional(),
    // Results that carry another institute's or reseller's id; unset means refuse
    RESPONSE_SCOPE_CHECK: z.enum(['refuse', 'report', 'off']).optional(),

    // Telemetry and OpenObserve (docs/deployment.md → "Telemetry and shutdown"). Unset endpoint: telemetry off.
    OTEL_EXPORTER_OTLP_ENDPOINT: z
      .url({
        protocol: /^https?$/,
        error: 'OTEL_EXPORTER_OTLP_ENDPOINT — OTLP gRPC URL (e.g. http://openobserve:5081)',
      })
      .optional(),
    OTEL_EXPORTER_OTLP_HEADERS: z
      .string()
      .regex(/^[^=,\s]+=[^,]+(,[^=,\s]+=[^,]+)*$/, {
        error: 'OTEL_EXPORTER_OTLP_HEADERS — comma-separated key=value pairs',
      })
      .optional(),
    OPENOBSERVE_URL: z
      .url({
        protocol: /^https?$/,
        error: 'OPENOBSERVE_URL — OpenObserve HTTP URL (e.g. http://openobserve:5080)',
      })
      .optional(),
    OPENOBSERVE_ORG: z.string().optional(),
    // The WhatsApp provider's API: a sender's token is checked against its account at
    // registration (ROV-333). Unset, registering or re-tokening a sender is refused.
    WHATSAPP_API_BASE_URL: z
      .url({ protocol: /^https?$/, error: 'WHATSAPP_API_BASE_URL — the provider API base URL' })
      .optional(),
    OPENOBSERVE_USER: z.string().optional(),
    OPENOBSERVE_PASSWORD: z.string().optional(),

    // Temporal — used by certificate (TC issuance) and admission workflows.
    // Address defaults to localhost:7233 inside services; CE-002 made the
    // task-queue name configurable so the worker queue can be renamed without
    // a code change in concert with the worker side.
    TEMPORAL_ADDRESS: z.string().optional(),
    TEMPORAL_TC_TASK_QUEUE: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Fail closed: only an environment that names itself development or test may run without a real key.
    if (isDevOrTest(env.NODE_ENV)) return;
    if (env.MESSAGING_ENCRYPTION_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['MESSAGING_ENCRYPTION_KEY'],
        message:
          'MESSAGING_ENCRYPTION_KEY — required unless NODE_ENV is development or test: 64 hex characters (32 bytes) that encrypt messaging sender access tokens',
      });
    } else if (env.MESSAGING_ENCRYPTION_KEY === DEV_MESSAGING_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['MESSAGING_ENCRYPTION_KEY'],
        message:
          'MESSAGING_ENCRYPTION_KEY — the all-zero development key is refused unless NODE_ENV is development or test; generate one with: openssl rand -hex 32',
      });
    }
    for (const issue of storageIssues(env)) ctx.addIssue({ code: 'custom', ...issue });
  });

function isDevOrTest(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}

function urlOrNull(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** A subdomain shares cookies set for the portal's domain, so it is no separate origin either. */
function isPortalHostOrSubdomain(host: string, portalHosts: Set<string>): boolean {
  for (const portal of portalHosts) {
    if (host === portal || host.endsWith(`.${portal}`)) return true;
  }
  return false;
}

/** A Docker service name or loopback: the server reaches the store on a private network. */
function isPrivateHost(host: string): boolean {
  return !host.includes('.') || host === '127.0.0.1';
}

/** Storage rules outside development and test (docs/deployment.md → "Object storage"). */
function storageIssues(env: {
  S3_ENDPOINT?: string;
  S3_PUBLIC_ENDPOINT?: string;
  S3_PUBLIC_BASE_URL?: string;
  S3_BUCKET_PRIVATE?: string;
  S3_BUCKET_PUBLIC?: string;
  ALLOWED_ORIGINS?: string;
}): { path: string[]; message: string }[] {
  const issues: { path: string[]; message: string }[] = [];
  const portalHosts = new Set(
    (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => urlOrNull(origin.trim())?.hostname)
      .filter((host): host is string => host !== undefined),
  );

  const server = urlOrNull(env.S3_ENDPOINT);
  if (server && server.protocol !== 'https:' && !isPrivateHost(server.hostname)) {
    issues.push({
      path: ['S3_ENDPOINT'],
      message:
        'S3_ENDPOINT — must be https unless it is a private host (a service name or 127.0.0.1)',
    });
  }
  // Browsers open these: plain http leaks every signed link, and a portal host would let an
  // uploaded file run script in that portal's origin.
  for (const name of ['S3_PUBLIC_ENDPOINT', 'S3_PUBLIC_BASE_URL'] as const) {
    const url = urlOrNull(env[name]);
    if (!url) continue;
    if (url.protocol !== 'https:') {
      issues.push({
        path: [name],
        message: `${name} — must be https outside development and test`,
      });
    }
    if (isPortalHostOrSubdomain(url.hostname, portalHosts)) {
      issues.push({
        path: [name],
        message: `${name} — must not be a portal host from ALLOWED_ORIGINS or its subdomain; serve storage from its own domain`,
      });
    }
  }
  if (env.S3_BUCKET_PRIVATE && env.S3_BUCKET_PRIVATE === env.S3_BUCKET_PUBLIC) {
    issues.push({
      path: ['S3_BUCKET_PUBLIC'],
      message: 'S3_BUCKET_PUBLIC — must differ from S3_BUCKET_PRIVATE',
    });
  }
  return issues;
}

export function validate(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues.map((i) => i.message);
    throw new Error(
      `Missing required environment variables — copy them from .env.example into .env:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return {
    ...result.data,
    MESSAGING_ENCRYPTION_KEY: result.data.MESSAGING_ENCRYPTION_KEY ?? DEV_MESSAGING_ENCRYPTION_KEY,
  };
}
