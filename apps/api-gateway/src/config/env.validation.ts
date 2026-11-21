import { z } from 'zod';

const envSchema = z.looseObject({
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
  NOVU_MODE: z.enum(['local', 'cloud']).optional(),
  NOVU_API_URL: z.string().url().optional(),
  BILLING_RETURN_URL: z.string().url().optional(),
  // Malware scanner for uploads; unset means clamav in production, eicar elsewhere (ROV-303)
  FILE_SCANNER: z.enum(['clamav', 'eicar']).optional(),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().optional(),

  // Temporal — used by certificate (TC issuance) and admission workflows.
  // Address defaults to localhost:7233 inside services; CE-002 made the
  // task-queue name configurable so the worker queue can be renamed without
  // a code change in concert with the worker side.
  TEMPORAL_ADDRESS: z.string().optional(),
  TEMPORAL_TC_TASK_QUEUE: z.string().optional(),
});

export function validate(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues.map((i) => i.message);
    throw new Error(
      `Missing required environment variables — copy them from .env.example into .env:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return result.data;
}
