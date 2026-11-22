import type { NotificationChannel } from '@roviq/common-types';
import { formatCalendarDate } from './calendar-date';
import {
  type Locale,
  localized,
  type OutsideCopy,
  type RegularNotificationType,
} from './notification-type';

export interface AttendanceAbsentParams {
  sessionId: string;
  /** Student membership id. */
  studentId: string;
  studentName: string | null;
  status: 'ABSENT' | 'LATE';
  markedAt: string;
  /** `YYYY-MM-DD` of the session; the copy leaves the date out without it. */
  sessionDate: string | null;
  sectionName: string | null;
  standardName: string | null;
}

function statusWord(status: AttendanceAbsentParams['status'], locale: Locale): string {
  if (locale === 'hi') return status === 'LATE' ? 'विलंब से उपस्थित' : 'अनुपस्थित';
  return status === 'LATE' ? 'late' : 'absent';
}

/** "Class 5-A" like the section's display label, or the section alone. */
function sectionLabel(p: AttendanceAbsentParams, locale: Locale): string | null {
  if (!p.sectionName) return null;
  if (p.standardName) return `${p.standardName}-${p.sectionName}`;
  return locale === 'hi' ? `सेक्शन ${p.sectionName}` : `Section ${p.sectionName}`;
}

function ward(p: AttendanceAbsentParams, locale: Locale): string {
  const who =
    locale === 'hi'
      ? p.studentName
        ? `आपके बच्चे ${p.studentName}`
        : 'आपके बच्चे'
      : p.studentName
        ? `Your ward ${p.studentName}`
        : 'Your ward';
  const section = sectionLabel(p, locale);
  return section ? `${who} (${section})` : who;
}

function single(p: AttendanceAbsentParams, locale: Locale): string {
  const date = formatCalendarDate(p.sessionDate, locale);
  if (locale === 'hi') {
    const marked = `${ward(p, locale)} को ${statusWord(p.status, locale)} दर्ज किया गया।`;
    return date ? `${date} को ${marked}` : marked;
  }
  const marked = `${ward(p, locale)} was marked ${statusWord(p.status, locale)}`;
  return date ? `${marked} on ${date}.` : `${marked}.`;
}

function singleSubject(p: AttendanceAbsentParams, locale: Locale): string {
  if (locale === 'hi') {
    const who = p.studentName ?? 'आपका बच्चा';
    return `उपस्थिति सूचना: ${who} ${p.status === 'LATE' ? 'विलंब से उपस्थित' : 'अनुपस्थित'}`;
  }
  const who = p.studentName ?? 'your ward';
  return `Attendance alert: ${who} was ${p.status === 'LATE' ? 'late' : 'absent'}`;
}

function digestSubject(items: readonly AttendanceAbsentParams[], locale: Locale): string {
  const late = items.filter((p) => p.status === 'LATE').length;
  const absent = items.length - late;
  if (locale === 'hi') {
    const parts = [absent > 0 ? `${absent} अनुपस्थिति` : null, late > 0 ? `${late} विलंब` : null];
    return `उपस्थिति सूचनाएँ: ${parts.filter(Boolean).join(', ')}`;
  }
  const parts = [
    absent > 0 ? `${absent} ${absent === 1 ? 'absence' : 'absences'}` : null,
    late > 0 ? `${late} ${late === 1 ? 'late arrival' : 'late arrivals'}` : null,
  ];
  return `Attendance alerts: ${parts.filter(Boolean).join(', ')}`;
}

function summary(
  items: readonly AttendanceAbsentParams[],
  channel: NotificationChannel,
  locale: Locale,
): OutsideCopy {
  const [first] = items;
  const one = items.length === 1 && first ? first : null;
  const body = one
    ? single(one, locale)
    : locale === 'hi'
      ? `आज उपस्थिति की ${items.length} सूचनाएँ दर्ज हुईं।`
      : `${items.length} attendance alerts were recorded today.`;
  if (channel === 'EMAIL') {
    return { subject: one ? singleSubject(one, locale) : digestSubject(items, locale), body };
  }
  return { subject: locale === 'hi' ? 'उपस्थिति सूचना' : 'Attendance Alert', body };
}

/** One alert per session, student, status and guardian, however often the entry is re-marked. */
export function attendanceAbsentDedupeKey(
  p: Pick<AttendanceAbsentParams, 'sessionId' | 'studentId' | 'status'>,
  recipientUserId: string,
): string {
  return `attendance:${p.sessionId}:${p.studentId}:${p.status}:${recipientUserId}`;
}

export const attendanceAbsentType: RegularNotificationType<AttendanceAbsentParams> = {
  key: 'ATTENDANCE_ABSENT',
  secret: false,
  settingsCategory: 'ATTENDANCE',
  critical: false,
  channels: ['WHATSAPP', 'EMAIL', 'PUSH'],
  digest: { defaultCron: '0 18 * * *', summaryCopy: summary },
  inAppCopy: (p) => ({
    title: localized((l) =>
      p.status === 'LATE'
        ? l === 'hi'
          ? 'देर से आने की सूचना'
          : 'Late arrival recorded'
        : l === 'hi'
          ? 'अनुपस्थिति दर्ज'
          : 'Absence recorded',
    ),
    body: localized((l) =>
      l === 'hi'
        ? `${single(p, l)} यदि यह सही नहीं है तो कृपया संस्थान से संपर्क करें।`
        : `${single(p, l)} Please contact the institute if this is incorrect.`,
    ),
    data: { sessionId: p.sessionId, studentId: p.studentId, path: '/institute/attendance' },
  }),
  outsideCopy: (p, channel, locale) => summary([p], channel, locale),
};
