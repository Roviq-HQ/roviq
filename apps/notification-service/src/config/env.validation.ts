import { z } from 'zod';

const envSchema = z.looseObject({
  // Database
  DATABASE_URL: z.string({
    error: 'DATABASE_URL — PostgreSQL connection string for the application runtime role',
  }),
  DATABASE_URL_ADMIN: z.string({
    error: 'DATABASE_URL_ADMIN — PostgreSQL connection string for the admin role (RLS bypass)',
  }),

  // NATS
  NATS_URL: z.string({
    error: 'NATS_URL — NATS server URL for event streaming (e.g. nats://localhost:4222)',
  }),

  // Novu
  NOVU_SECRET_KEY: z.string({
    error: 'NOVU_SECRET_KEY — Novu Cloud secret key for server-side API calls',
  }),
  NOVU_APP_ID: z.string({
    error: 'NOVU_APP_ID — Novu application identifier',
  }),

  // Optional
  NODE_ENV: z.string().optional(),
  NOTIFICATION_SERVICE_PORT: z.coerce.number().optional(),
  LOG_LEVEL: z.string().optional(),
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
