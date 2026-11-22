import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';
import { type Locale, localized, type RegularNotificationType } from './notification-type';

export interface AuthSecurityParams {
  ip: string | null;
  /** ISO time of the event. */
  at: string;
  /** Deep link to the account page of the portal the event belongs to. */
  accountPath: string;
}

type AuthAlertKey = Extract<
  NotificationTypeKey,
  | 'AUTH_LOGIN'
  | 'AUTH_PASSWORD_RESET'
  | 'AUTH_NEW_DEVICE'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'AUTH_SESSION_REVOKED'
>;

/** Product audience is in India; one fixed zone keeps the copy the same in every channel. */
function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

interface AuthCopy {
  subject: Record<Locale, string>;
  body(time: string, ip: string, locale: Locale): string;
}

const UNKNOWN_IP: Record<Locale, string> = { en: 'unknown', hi: 'अज्ञात' };

const COPY: Record<AuthAlertKey, AuthCopy> = {
  AUTH_LOGIN: {
    subject: { en: 'New sign-in to your account', hi: 'आपके खाते में नया साइन-इन' },
    body: (time, ip, l) =>
      l === 'hi'
        ? `${time} पर IP ${ip} से नया साइन-इन हुआ। यदि यह आप नहीं थे, तो तुरंत अपना खाता सुरक्षित करें।`
        : `A new sign-in was detected from IP ${ip} at ${time}. If this wasn't you, secure your account immediately.`,
  },
  AUTH_PASSWORD_RESET: {
    subject: { en: 'Password reset requested', hi: 'पासवर्ड रीसेट का अनुरोध' },
    body: (time, _ip, l) =>
      l === 'hi'
        ? `${time} पर आपके खाते का पासवर्ड रीसेट करने का अनुरोध किया गया। यदि यह आप नहीं थे, तो सहायता टीम से संपर्क करें।`
        : `A password reset was requested for your account at ${time}. If this wasn't you, contact support.`,
  },
  AUTH_NEW_DEVICE: {
    subject: { en: 'New device sign-in', hi: 'नए उपकरण से साइन-इन' },
    body: (time, ip, l) =>
      l === 'hi'
        ? `${time} पर एक नए उपकरण से आपके खाते में प्रवेश हुआ (IP: ${ip})। यदि यह आप नहीं थे, तो अपना खाता सुरक्षित करें।`
        : `Your account was accessed from a new device at ${time} (IP: ${ip}). If this wasn't you, secure your account.`,
  },
  AUTH_ACCOUNT_LOCKED: {
    subject: { en: 'Account locked', hi: 'खाता लॉक किया गया' },
    body: (time, _ip, l) =>
      l === 'hi'
        ? `${time} पर कई बार गलत प्रयासों के कारण आपका खाता लॉक कर दिया गया है। इसे खुलवाने के लिए सहायता टीम से संपर्क करें।`
        : `Your account has been locked due to too many failed attempts at ${time}. Contact support to unlock.`,
  },
  AUTH_SESSION_REVOKED: {
    subject: { en: 'Session revoked', hi: 'सत्र रद्द किया गया' },
    body: (time, _ip, l) =>
      l === 'hi'
        ? `${time} पर आपके खाते का एक सत्र रद्द किया गया। यदि यह आप नहीं थे, तो तुरंत अपना पासवर्ड बदलें।`
        : `A session was revoked for your account at ${time}. If this wasn't you, change your password immediately.`,
  },
};

const BASE_CHANNELS: readonly NotificationChannel[] = ['EMAIL', 'PUSH'];
// WhatsApp only where the user must act at once.
const WITH_WHATSAPP: readonly NotificationChannel[] = ['EMAIL', 'WHATSAPP', 'PUSH'];

function authAlertType(
  key: AuthAlertKey,
  channels: readonly NotificationChannel[],
): RegularNotificationType<AuthSecurityParams> {
  const copy = COPY[key];
  const body = (p: AuthSecurityParams, l: Locale) =>
    copy.body(formatTime(p.at, l), p.ip ?? UNKNOWN_IP[l], l);
  return {
    key,
    secret: false,
    settingsCategory: null,
    critical: true,
    channels,
    digest: null,
    inAppCopy: (p) => ({
      title: localized((l) => copy.subject[l]),
      body: localized((l) => body(p, l)),
      data: { path: p.accountPath },
    }),
    outsideCopy: (p, _channel, locale) => ({
      subject: copy.subject[locale],
      body: body(p, locale),
    }),
  };
}

export const authLoginType = authAlertType('AUTH_LOGIN', BASE_CHANNELS);
export const authPasswordResetType = authAlertType('AUTH_PASSWORD_RESET', WITH_WHATSAPP);
export const authNewDeviceType = authAlertType('AUTH_NEW_DEVICE', WITH_WHATSAPP);
export const authAccountLockedType = authAlertType('AUTH_ACCOUNT_LOCKED', BASE_CHANNELS);
export const authSessionRevokedType = authAlertType('AUTH_SESSION_REVOKED', BASE_CHANNELS);
