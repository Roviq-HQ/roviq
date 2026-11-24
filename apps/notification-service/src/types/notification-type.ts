import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';
import type { NotificationFlow } from './flow';

export type Locale = 'en' | 'hi';

export const LOCALES: readonly Locale[] = ['en', 'hi'];

/** Copy stored on the in-app row; the frontend picks the locale. */
export interface LocalizedText {
  en: string;
  hi: string;
}

export interface InAppCopy {
  title: LocalizedText;
  body: LocalizedText;
  /** Entity ids and the deep-link `path`. Never a code or a password. */
  data: Record<string, string | number | null>;
}

/** One message on one channel outside the app, in one locale. SMS and WhatsApp use `body` only. */
export interface OutsideCopy {
  subject: string;
  body: string;
}

/** `institute_notification_configs.notification_type` a type reads its channel settings from. */
export type SettingsCategory = 'ATTENDANCE' | 'FEE' | 'APPROVAL';

interface NotificationTypeBase<P> {
  key: NotificationTypeKey;
  outsideCopy(params: P, channel: NotificationChannel, locale: Locale): OutsideCopy;
}

/**
 * Carries a one-time code or a password. Sent inside the listener call only: no in-app row,
 * no Temporal input, no stored text. Institute settings do not apply.
 */
export interface SecretNotificationType<P> extends NotificationTypeBase<P> {
  secret: true;
  /** Channels this type is sent on, in order. A channel not listed produces no delivery row. */
  channels: readonly NotificationChannel[];
}

export interface RegularNotificationType<P> extends NotificationTypeBase<P> {
  secret: false;
  /** Which channels are tried, in what order, and how long each waits for arrival (ROV-332). */
  flow: NotificationFlow;
  /** Null for system types (auth, billing). */
  settingsCategory: SettingsCategory | null;
  /** Ignores institute settings: every channel of the flow is sent. */
  critical: boolean;
  inAppCopy(params: P): InAppCopy;
  digest: DigestSpec<P> | null;
}

export interface DigestSpec<P> {
  /** Cron in the institute's timezone, used unless the institute sets its own. */
  defaultCron: string;
  /** One summary for everything collected in a window; `items` is never empty. */
  summaryCopy(items: readonly P[], channel: NotificationChannel, locale: Locale): OutsideCopy;
}

export type NotificationType<P> = SecretNotificationType<P> | RegularNotificationType<P>;

export function localized(compose: (locale: Locale) => string): LocalizedText {
  return { en: compose('en'), hi: compose('hi') };
}
