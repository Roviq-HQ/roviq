import type { NotificationChannel } from '@roviq/common-types';
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
  channels: ['WHATSAPP', 'EMAIL', 'PUSH'],
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
  channels: ['EMAIL', 'WHATSAPP', 'PUSH'],
  digest: null,
  inAppCopy: (p) => ({
    title: localized(reminderTitle),
    body: localized((l) => reminderLine(p, l)),
    data: { feeId: p.feeId, studentId: p.studentId, path: FEE_PATH },
  }),
  outsideCopy: (p, _channel, locale) => ({
    subject: reminderTitle(locale),
    body: reminderLine(p, locale),
  }),
};
