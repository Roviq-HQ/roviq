import { z } from 'zod';

const envSchema = z
  .looseObject({
    // Database
    DATABASE_URL: z.string({
      error: 'DATABASE_URL — PostgreSQL connection string for the application runtime role',
    }),

    // NATS
    NATS_URL: z.string({
      error: 'NATS_URL — NATS server URL for event streaming (e.g. nats://localhost:4222)',
    }),

    // Novu — still read by the subscriber sync and device token services until they are removed
    NOVU_SECRET_KEY: z.string({
      error: 'NOVU_SECRET_KEY — Novu secret key for server-side API calls',
    }),
    NOVU_APPLICATION_IDENTIFIER: z.string({
      error: 'NOVU_APPLICATION_IDENTIFIER — Novu application identifier',
    }),

    // Temporal: the notification worker runs only when the flag is 'true'
    TEMPORAL_ADDRESS: z.string().optional(),
    NOTIFICATION_WORKER_ENABLED: z.enum(['true', 'false']).optional(),

    // Channel providers; unset means the channel has no provider and every send is skipped
    NOTIFICATION_EMAIL_PROVIDER: z.enum(['smtp', 'log']).optional(),
    NOTIFICATION_PUSH_PROVIDER: z.enum(['fcm', 'log']).optional(),
    NOTIFICATION_SMS_PROVIDER: z.enum(['log']).optional(),
    NOTIFICATION_WHATSAPP_PROVIDER: z.enum(['log']).optional(),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),

    // Optional
    NODE_ENV: z.string().optional(),
    NOVU_MODE: z.enum(['local', 'cloud']).optional(),
    NOVU_API_URL: z.string().url().optional(),
    NOTIFICATION_SERVICE_PORT: z.coerce.number().optional(),
    LOG_LEVEL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NOTIFICATION_EMAIL_PROVIDER === 'smtp' && (!env.SMTP_URL || !env.EMAIL_FROM)) {
      ctx.addIssue({
        code: 'custom',
        message: 'SMTP_URL and EMAIL_FROM — required when NOTIFICATION_EMAIL_PROVIDER=smtp',
      });
    }
    if (env.NOTIFICATION_PUSH_PROVIDER === 'fcm' && !env.FCM_SERVICE_ACCOUNT_JSON) {
      ctx.addIssue({
        code: 'custom',
        message: 'FCM_SERVICE_ACCOUNT_JSON — required when NOTIFICATION_PUSH_PROVIDER=fcm',
      });
    }
    if (env.NODE_ENV === 'production') {
      const logged = (
        [
          ['NOTIFICATION_EMAIL_PROVIDER', env.NOTIFICATION_EMAIL_PROVIDER],
          ['NOTIFICATION_PUSH_PROVIDER', env.NOTIFICATION_PUSH_PROVIDER],
          ['NOTIFICATION_SMS_PROVIDER', env.NOTIFICATION_SMS_PROVIDER],
          ['NOTIFICATION_WHATSAPP_PROVIDER', env.NOTIFICATION_WHATSAPP_PROVIDER],
        ] as const
      )
        .filter(([, provider]) => provider === 'log')
        .map(([name]) => name);
      if (logged.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `${logged.join(', ')} — the 'log' provider sends nothing and is refused in production`,
        });
      }
    }
  });

export type NotificationEnv = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): NotificationEnv {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues.map((i) => i.message);
    throw new Error(
      `Invalid notification-service environment — copy the variables from .env.example into .env:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return result.data;
}
