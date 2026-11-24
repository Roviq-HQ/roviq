import type { NotificationChannel } from '@roviq/common-types';

/** The setting that names each channel's providers, and the names it accepts. */
export const CHANNEL_PROVIDERS = {
  EMAIL: { setting: 'NOTIFICATION_EMAIL_PROVIDER', names: ['smtp', 'log'] },
  PUSH: { setting: 'NOTIFICATION_PUSH_PROVIDER', names: ['fcm', 'log'] },
  SMS: { setting: 'NOTIFICATION_SMS_PROVIDER', names: ['http', 'log'] },
  WHATSAPP: { setting: 'NOTIFICATION_WHATSAPP_PROVIDER', names: ['cloud', 'log'] },
} as const satisfies Record<NotificationChannel, { setting: string; names: readonly string[] }>;

export type ProviderNameOf<C extends NotificationChannel> =
  (typeof CHANNEL_PROVIDERS)[C]['names'][number];

/** The names in a setting, in order; empty entries are kept so validation can refuse them. */
export function splitProviderSetting(value: string | undefined): string[] {
  return value === undefined ? [] : value.split(',').map((name) => name.trim());
}

/** Why a setting is refused, or null when every name is known and named once. */
export function providerSettingError(
  channel: NotificationChannel,
  value: string | undefined,
): string | null {
  const { setting, names } = CHANNEL_PROVIDERS[channel];
  const known: readonly string[] = names;
  const listed = splitProviderSetting(value);
  const unknown = listed.find((name) => !known.includes(name));
  if (unknown !== undefined) {
    return `${setting} — unknown provider '${unknown}'; give one or a comma-separated ordered list of: ${known.join(', ')}`;
  }
  const twice = listed.find((name, index) => listed.indexOf(name) !== index);
  if (twice !== undefined) return `${setting} — provider '${twice}' is named twice`;
  return null;
}

/** The providers a validated setting names, first choice first. */
export function providersOf<C extends NotificationChannel>(
  channel: C,
  value: string | undefined,
): ProviderNameOf<C>[] {
  const known: readonly string[] = CHANNEL_PROVIDERS[channel].names;
  return splitProviderSetting(value).filter((name): name is ProviderNameOf<C> =>
    known.includes(name),
  );
}
