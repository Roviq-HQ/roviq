import type { NotificationChannel } from '@roviq/common-types';
import { z } from 'zod';
import { SMS_TEMPLATE_IDS_ERROR, SmsRegistrations } from '../delivery/sms/sms-registrations';
import { CANARY_ADDRESS_SETTING, parseCanaryChannels } from './canary-settings';
import { CHANNEL_PROVIDERS, providerSettingError, splitProviderSetting } from './channel-providers';

/** One provider, or a comma-separated list tried in order when one cannot send. */
const providerSetting = (channel: NotificationChannel) =>
  z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      const error = providerSettingError(channel, value);
      if (error !== null) ctx.addIssue({ code: 'custom', message: error });
    });

const names = (value: string | undefined, name: string) =>
  splitProviderSetting(value).includes(name);

const envSchema = z
  .looseObject({
    // Database
    DATABASE_URL: z.string({
      error: 'DATABASE_URL — PostgreSQL connection string for the application runtime role',
    }),

    // Redis: sender rate limits and provider breakers, shared by every instance
    REDIS_URL: z.string({
      error: 'REDIS_URL — Redis connection URL (e.g. redis://localhost:6379)',
    }),

    // NATS
    NATS_URL: z.string({
      error: 'NATS_URL — NATS server URL for event streaming (e.g. nats://localhost:4222)',
    }),

    // Temporal: the notification worker runs only when the flag is 'true'
    TEMPORAL_ADDRESS: z.string().optional(),
    NOTIFICATION_WORKER_ENABLED: z.enum(['true', 'false']).optional(),

    // Channel providers, first choice first; unset means the channel has no provider and every send is skipped
    NOTIFICATION_EMAIL_PROVIDER: providerSetting('EMAIL'),
    NOTIFICATION_PUSH_PROVIDER: providerSetting('PUSH'),
    NOTIFICATION_SMS_PROVIDER: providerSetting('SMS'),
    NOTIFICATION_WHATSAPP_PROVIDER: providerSetting('WHATSAPP'),
    // WhatsApp provider ('cloud'): API address, webhook secrets, and the key sender tokens are encrypted with
    WHATSAPP_API_BASE_URL: z.url().optional(),
    WHATSAPP_APP_SECRET: z.string().min(1).optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),
    MESSAGING_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'MESSAGING_ENCRYPTION_KEY — 64 hex characters (32 bytes)')
      .optional(),
    // SMS provider ('http'): API address and key, sender header, template registrations, report secret
    SMS_API_BASE_URL: z.url().optional(),
    SMS_API_KEY: z.string().min(1).optional(),
    SMS_SENDER_ID: z.string().min(1).optional(),
    SMS_TEMPLATE_IDS: z.string().min(1).optional(),
    SMS_WEBHOOK_SECRET: z
      .string()
      .min(32, 'SMS_WEBHOOK_SECRET — at least 32 characters')
      .optional(),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),

    // Public address of the institute portal, named in sign-in details; defaults to localhost:WEB_PORT
    INSTITUTE_PORTAL_URL: z.string().optional(),
    WEB_PORT: z.string().optional(),

    // Delivery canary: unset channels = off. Each listed channel needs its provider and address
    NOTIFICATION_CANARY_CHANNELS: z.string().optional(),
    NOTIFICATION_CANARY_USER_ID: z
      .uuid(
        'NOTIFICATION_CANARY_USER_ID — the id of the platform user canary rows are recorded against',
      )
      .optional(),
    NOTIFICATION_CANARY_EMAIL: z
      .email('NOTIFICATION_CANARY_EMAIL — an email address the platform team reads')
      .optional(),
    NOTIFICATION_CANARY_PHONE: z
      .string()
      .regex(
        /^\+[1-9]\d{7,14}$/,
        'NOTIFICATION_CANARY_PHONE — a phone number with country code, e.g. +919800000000',
      )
      .optional(),

    // Optional
    NODE_ENV: z.string().optional(),
    NOTIFICATION_SERVICE_PORT: z.coerce.number().optional(),
    LOG_LEVEL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (names(env.NOTIFICATION_EMAIL_PROVIDER, 'smtp') && (!env.SMTP_URL || !env.EMAIL_FROM)) {
      ctx.addIssue({
        code: 'custom',
        message: 'SMTP_URL and EMAIL_FROM — required when NOTIFICATION_EMAIL_PROVIDER=smtp',
      });
    }
    if (names(env.NOTIFICATION_PUSH_PROVIDER, 'fcm') && !env.FCM_SERVICE_ACCOUNT_JSON) {
      ctx.addIssue({
        code: 'custom',
        message: 'FCM_SERVICE_ACCOUNT_JSON — required when NOTIFICATION_PUSH_PROVIDER=fcm',
      });
    }
    if (names(env.NOTIFICATION_WHATSAPP_PROVIDER, 'cloud')) {
      const missing = (
        [
          'WHATSAPP_API_BASE_URL',
          'WHATSAPP_APP_SECRET',
          'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
          'MESSAGING_ENCRYPTION_KEY',
        ] as const
      ).filter((name) => !env[name]);
      if (missing.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `${missing.join(', ')} — required when NOTIFICATION_WHATSAPP_PROVIDER=cloud`,
        });
      }
    }
    if (names(env.NOTIFICATION_SMS_PROVIDER, 'http')) {
      const missing = (
        ['SMS_API_BASE_URL', 'SMS_API_KEY', 'SMS_TEMPLATE_IDS', 'SMS_WEBHOOK_SECRET'] as const
      ).filter((name) => !env[name]);
      if (missing.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `${missing.join(', ')} — required when NOTIFICATION_SMS_PROVIDER=http`,
        });
      }
    }
    for (const message of canaryIssues(env)) ctx.addIssue({ code: 'custom', message });
    if (env.SMS_TEMPLATE_IDS) {
      try {
        new SmsRegistrations(env.SMS_TEMPLATE_IDS);
      } catch {
        ctx.addIssue({ code: 'custom', message: SMS_TEMPLATE_IDS_ERROR });
      }
    }
    if (
      env.NODE_ENV !== 'development' &&
      env.NODE_ENV !== 'test' &&
      env.MESSAGING_ENCRYPTION_KEY &&
      /^0+$/.test(env.MESSAGING_ENCRYPTION_KEY)
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'MESSAGING_ENCRYPTION_KEY — the all-zero development key is refused unless NODE_ENV is development or test',
      });
    }
    if (env.NODE_ENV === 'production') {
      const logged = Object.values(CHANNEL_PROVIDERS)
        .map(({ setting }) => [setting, env[setting]] as const)
        .filter(([, value]) => names(value, 'log'))
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

function canaryIssues(
  env: Pick<
    NotificationEnv,
    | 'NOTIFICATION_EMAIL_PROVIDER'
    | 'NOTIFICATION_PUSH_PROVIDER'
    | 'NOTIFICATION_SMS_PROVIDER'
    | 'NOTIFICATION_WHATSAPP_PROVIDER'
    | 'NOTIFICATION_CANARY_CHANNELS'
    | 'NOTIFICATION_CANARY_USER_ID'
    | 'NOTIFICATION_CANARY_EMAIL'
    | 'NOTIFICATION_CANARY_PHONE'
  >,
): string[] {
  if (!env.NOTIFICATION_CANARY_CHANNELS) return [];
  const channels = parseCanaryChannels(env.NOTIFICATION_CANARY_CHANNELS);
  if (channels === null) {
    return [
      'NOTIFICATION_CANARY_CHANNELS — a comma-separated list of distinct channels from EMAIL, PUSH, SMS, WHATSAPP',
    ];
  }
  const issues: string[] = [];
  if (!env.NOTIFICATION_CANARY_USER_ID) {
    issues.push('NOTIFICATION_CANARY_USER_ID — required when NOTIFICATION_CANARY_CHANNELS is set');
  }
  const unsent = channels
    .map((channel) => CHANNEL_PROVIDERS[channel].setting)
    .filter((name) => !env[name]);
  if (unsent.length > 0) {
    issues.push(`${unsent.join(', ')} — required for the channels in NOTIFICATION_CANARY_CHANNELS`);
  }
  const missing = [
    ...new Set(
      channels
        .map((channel) => CANARY_ADDRESS_SETTING[channel])
        .filter((name) => name !== null && !env[name]),
    ),
  ];
  if (missing.length > 0) {
    issues.push(
      `${missing.join(', ')} — required for the channels in NOTIFICATION_CANARY_CHANNELS`,
    );
  }
  return issues;
}

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
