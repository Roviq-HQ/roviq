import { MessageTemplateCategory, type NotificationChannel } from '@roviq/common-types';
import { buttonPathOf, nameList } from '../delivery/whatsapp/template-variables';
import {
  cleanVariable,
  renderTemplate,
  type WhatsAppTemplate,
} from '../delivery/whatsapp/whatsapp-template';
import type { TypeTemplates } from '../delivery/whatsapp/whatsapp-templates';
import { formatCalendarDate } from './calendar-date';
import { guardianAlertFlow } from './flow';
import {
  type Locale,
  localized,
  type OutsideCopy,
  type RegularNotificationType,
} from './notification-type';

export interface FeeOverdueParams {
  /** Student membership id. */
  studentId: string;
  studentName: string;
  feeId: string;
  amount: number;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  feeType: string;
}

export interface FeeReminderParams {
  /** Student membership id. */
  studentId: string;
  studentName: string;
  feeId: string;
  amount: number;
  currency: string;
  dueDate: string;
  feeType: string;
  feePeriod: string;
}

const FEE_PATH = '/institute/dashboard';

const WARD: Record<Locale, string> = { en: 'your ward', hi: 'आपके बच्चे' };
const FEE_KIND: Record<Locale, string> = { en: 'general', hi: 'सामान्य' };
const NOT_SET: Record<Locale, string> = { en: 'not set', hi: 'उपलब्ध नहीं' };

function amountVariable(p: { amount: number; currency: string }, locale: Locale): string {
  return cleanVariable(`${p.currency} ${p.amount}`, NOT_SET[locale]);
}

/** A malformed due date is shown as stored rather than dropped. */
function dueDateVariable(dueDate: string, locale: Locale): string {
  return cleanVariable(formatCalendarDate(dueDate, locale) ?? dueDate, NOT_SET[locale]);
}

const overdueWhatsAppSingle: WhatsAppTemplate<FeeOverdueParams> = {
  name: 'fee_overdue_v1',
  category: MessageTemplateCategory.UTILITY,
  body: {
    en: 'Fee overdue: {{1}} has an unpaid fee ({{2}}) of {{3}} that was due on {{4}}.',
    hi: 'शुल्क बकाया: {{1}} का शुल्क ({{2}}) {{3}} बकाया है, जिसकी देय तिथि {{4}} थी।',
  },
  variables: (p, locale) => [
    cleanVariable(p.studentName, WARD[locale]),
    cleanVariable(p.feeType, FEE_KIND[locale]),
    amountVariable(p, locale),
    dueDateVariable(p.dueDate, locale),
  ],
  buttonPath: () => buttonPathOf(FEE_PATH),
};

const overdueWhatsAppDigest: WhatsAppTemplate<readonly FeeOverdueParams[]> = {
  name: 'fee_overdue_digest_v1',
  category: MessageTemplateCategory.UTILITY,
  body: {
    en: 'Fee overdue summary for {{1}}: {{2}} fees are unpaid past their due date this week.',
    hi: 'बकाया शुल्क सारांश, {{1}}: इस सप्ताह {{2}} शुल्क देय तिथि के बाद भी बकाया हैं।',
  },
  variables: (items, locale) => [
    nameList(
      items.map((p) => p.studentName),
      locale === 'hi' ? 'आपका बच्चा' : 'your ward',
      locale,
    ),
    String(items.length),
  ],
  buttonPath: () => buttonPathOf(FEE_PATH),
};

export const feeOverdueWhatsApp: TypeTemplates<FeeOverdueParams> = {
  single: overdueWhatsAppSingle,
  digest: overdueWhatsAppDigest,
};

const reminderWhatsApp: WhatsAppTemplate<FeeReminderParams> = {
  name: 'fee_reminder_v1',
  category: MessageTemplateCategory.UTILITY,
  body: {
    en: 'Fee reminder: {{1}} has a fee ({{2}}) of {{3}} for {{4}}, due on {{5}}.',
    hi: 'शुल्क अनुस्मारक: {{1}} का शुल्क ({{2}}) {{3}}, अवधि {{4}}, {{5}} तक देय है।',
  },
  variables: (p, locale) => [
    cleanVariable(p.studentName, WARD[locale]),
    cleanVariable(p.feeType, FEE_KIND[locale]),
    amountVariable(p, locale),
    cleanVariable(p.feePeriod, locale === 'hi' ? 'वर्तमान अवधि' : 'the current period'),
    dueDateVariable(p.dueDate, locale),
  ],
  buttonPath: () => buttonPathOf(FEE_PATH),
};

export const feeReminderWhatsApp: TypeTemplates<FeeReminderParams> = { single: reminderWhatsApp };

function overdueLine(p: FeeOverdueParams, locale: Locale): string {
  return locale === 'hi'
    ? `${p.studentName} का ${p.feeType} शुल्क ${p.currency} ${p.amount} बकाया है।`
    : `${p.studentName} has an overdue ${p.feeType} fee of ${p.currency} ${p.amount}.`;
}

function overdueSummary(
  items: readonly FeeOverdueParams[],
  channel: NotificationChannel,
  locale: Locale,
): OutsideCopy {
  const [first] = items;
  const n = items.length;
  if (channel === 'WHATSAPP') {
    return {
      subject: locale === 'hi' ? 'शुल्क बकाया' : 'Fee Overdue',
      body:
        n === 1 && first
          ? renderTemplate(
              overdueWhatsAppSingle.body[locale],
              overdueWhatsAppSingle.variables(first, locale),
            )
          : renderTemplate(
              overdueWhatsAppDigest.body[locale],
              overdueWhatsAppDigest.variables(items, locale),
            ),
    };
  }
  const body =
    n === 1 && first
      ? overdueLine(first, locale)
      : locale === 'hi'
        ? `इस सप्ताह बकाया शुल्क की ${n} सूचनाएँ।`
        : `${n} overdue fee reminder(s) this week.`;
  if (channel === 'EMAIL') {
    return {
      subject: locale === 'hi' ? `शुल्क बकाया: ${n} सूचना` : `Fee Overdue: ${n} reminder(s)`,
      body,
    };
  }
  return { subject: locale === 'hi' ? 'शुल्क बकाया' : 'Fee Overdue', body };
}

export const feeOverdueType: RegularNotificationType<FeeOverdueParams> = {
  key: 'FEE_OVERDUE',
  secret: false,
  settingsCategory: 'FEE',
  critical: false,
  flow: guardianAlertFlow(),
  // Weekly, Monday 09:00 in the institute's timezone.
  digest: { defaultCron: '0 9 * * 1', summaryCopy: overdueSummary },
  inAppCopy: (p) => ({
    title: localized((l) => (l === 'hi' ? 'शुल्क बकाया' : 'Fee Overdue')),
    body: localized((l) =>
      l === 'hi'
        ? `${p.studentName} का ${p.feeType} शुल्क ${p.currency} ${p.amount} बकाया है (देय तिथि ${p.dueDate})।`
        : `${p.studentName} has an overdue ${p.feeType} fee of ${p.currency} ${p.amount} (due ${p.dueDate}).`,
    ),
    data: { feeId: p.feeId, studentId: p.studentId, path: FEE_PATH },
  }),
  outsideCopy: (p, channel, locale) => overdueSummary([p], channel, locale),
};

function reminderLine(p: FeeReminderParams, locale: Locale): string {
  return locale === 'hi'
    ? `${p.studentName} का ${p.feePeriod} का ${p.feeType} शुल्क ${p.currency} ${p.amount} ${p.dueDate} तक देय है।`
    : `${p.studentName} has an upcoming ${p.feeType} fee of ${p.currency} ${p.amount} for ${p.feePeriod}, due ${p.dueDate}.`;
}

const reminderTitle = (locale: Locale) => (locale === 'hi' ? 'शुल्क अनुस्मारक' : 'Fee Reminder');

export const feeReminderType: RegularNotificationType<FeeReminderParams> = {
  key: 'FEE_REMINDER',
  secret: false,
  settingsCategory: 'FEE',
  critical: false,
  flow: guardianAlertFlow(),
  digest: null,
  inAppCopy: (p) => ({
    title: localized(reminderTitle),
    body: localized((l) => reminderLine(p, l)),
    data: { feeId: p.feeId, studentId: p.studentId, path: FEE_PATH },
  }),
  outsideCopy: (p, channel, locale) => ({
    subject: reminderTitle(locale),
    body:
      channel === 'WHATSAPP'
        ? renderTemplate(reminderWhatsApp.body[locale], reminderWhatsApp.variables(p, locale))
        : reminderLine(p, locale),
  }),
};
