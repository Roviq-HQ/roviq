import type { NotificationChannel } from '@roviq/common-types';
import type { NotificationConfigRecord } from '../repositories/types';

export interface ChannelSettings {
  inApp: boolean;
  channels: Record<NotificationChannel, boolean>;
  /** Cron to collect outside-channel messages by; null sends each one at once. */
  digestCron: string | null;
}

/** Used when the institute has no row for the category (same as before ROV-314). */
const DEFAULTS: NotificationConfigRecord = {
  inAppEnabled: true,
  whatsappEnabled: true,
  emailEnabled: true,
  pushEnabled: false,
  digestEnabled: true,
  digestCron: null,
};

export interface SettingsSubject {
  /** Critical and secret types ignore institute settings. */
  ignoresInstituteSettings: boolean;
  defaultDigestCron: string | null;
}

export function resolveChannelSettings(
  subject: SettingsSubject,
  row: NotificationConfigRecord | null,
): ChannelSettings {
  if (subject.ignoresInstituteSettings) {
    return {
      inApp: true,
      channels: { EMAIL: true, PUSH: true, SMS: true, WHATSAPP: true },
      digestCron: subject.defaultDigestCron,
    };
  }
  const config = row ?? DEFAULTS;
  return {
    inApp: config.inAppEnabled,
    // No setting exists for SMS; only secret types use it.
    channels: {
      EMAIL: config.emailEnabled,
      PUSH: config.pushEnabled,
      SMS: true,
      WHATSAPP: config.whatsappEnabled,
    },
    digestCron:
      subject.defaultDigestCron === null || !config.digestEnabled
        ? null
        : (config.digestCron ?? subject.defaultDigestCron),
  };
}
