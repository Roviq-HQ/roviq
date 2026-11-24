import { NOTIFICATION_CHANNEL_VALUES, type NotificationChannel } from '@roviq/common-types';

/** What the delivery canary sends, and to whom. Null when `NOTIFICATION_CANARY_CHANNELS` is unset. */
export interface CanarySettings {
  channels: readonly NotificationChannel[];
  /** The platform user the canary's delivery rows are recorded against; push goes to its devices. */
  userId: string;
  email: string | null;
  phone: string | null;
}

const isChannel = (value: string): value is NotificationChannel =>
  NOTIFICATION_CHANNEL_VALUES.some((channel) => channel === value);

/** Null when the value is not a comma-separated list of distinct channels. */
export function parseCanaryChannels(value: string): NotificationChannel[] | null {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0 || new Set(parts).size !== parts.length) return null;
  const channels: NotificationChannel[] = [];
  for (const part of parts) {
    if (!isChannel(part)) return null;
    channels.push(part);
  }
  return channels;
}

/** The address setting a channel needs; push needs none (it uses the canary user's devices). */
export const CANARY_ADDRESS_SETTING: Record<
  NotificationChannel,
  'NOTIFICATION_CANARY_EMAIL' | 'NOTIFICATION_CANARY_PHONE' | null
> = {
  EMAIL: 'NOTIFICATION_CANARY_EMAIL',
  PUSH: null,
  SMS: 'NOTIFICATION_CANARY_PHONE',
  WHATSAPP: 'NOTIFICATION_CANARY_PHONE',
};

export interface CanaryEnv {
  NOTIFICATION_CANARY_CHANNELS?: string;
  NOTIFICATION_CANARY_USER_ID?: string;
  NOTIFICATION_CANARY_EMAIL?: string;
  NOTIFICATION_CANARY_PHONE?: string;
}

/** Reads the validated environment; the validation refuses every inconsistent combination. */
export function canarySettingsOf(env: CanaryEnv): CanarySettings | null {
  if (!env.NOTIFICATION_CANARY_CHANNELS) return null;
  const channels = parseCanaryChannels(env.NOTIFICATION_CANARY_CHANNELS);
  if (channels === null || !env.NOTIFICATION_CANARY_USER_ID) {
    throw new Error('NOTIFICATION_CANARY_* settings were not validated');
  }
  return {
    channels,
    userId: env.NOTIFICATION_CANARY_USER_ID,
    email: env.NOTIFICATION_CANARY_EMAIL ?? null,
    phone: env.NOTIFICATION_CANARY_PHONE ?? null,
  };
}
