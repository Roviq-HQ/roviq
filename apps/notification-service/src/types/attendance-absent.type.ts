import { MessageTemplateCategory, type NotificationChannel } from '@roviq/common-types';
import { buttonPathOf, nameList } from '../delivery/whatsapp/template-variables';
import {
  cleanVariable,
  OPEN_ROVIQ,
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

const ATTENDANCE_PATH = '/institute/attendance';

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

const WARD: Record<Locale, string> = { en: 'your ward', hi: 'आपके बच्चे' };

const ATTENDANCE_EXAMPLE: AttendanceAbsentParams = {
  sessionId: 'session-1',
  studentId: 'membership-student-1',
  studentName: 'Aarav Sharma',
  status: 'ABSENT',
  markedAt: '2026-11-22T03:35:00.000Z',
  sessionDate: '2026-11-22',
  sectionName: 'A',
  standardName: 'Class 5',
};

const whatsappSingle: WhatsAppTemplate<AttendanceAbsentParams> = {
  name: 'attendance_absent_v1',
  category: MessageTemplateCategory.UTILITY,
  body: {
    en: 'Attendance update for {{1}} in {{2}}: marked {{3}} on {{4}}. Open Roviq to see the details.',
    hi: 'उपस्थिति सूचना: {{1}} को, जो {{2}} में हैं, {{3}} दर्ज किया गया, तिथि {{4}}। विवरण के लिए Roviq खोलें।',
  },
  variables: (p, locale) => [
    cleanVariable(p.studentName ?? '', WARD[locale]),
    cleanVariable(sectionLabel(p, locale) ?? '', locale === 'hi' ? 'अपनी कक्षा' : 'their class'),
    statusWord(p.status, locale),
    cleanVariable(
      formatCalendarDate(p.sessionDate, locale) ?? '',
      locale === 'hi' ? 'आज' : 'today',
    ),
  ],
  buttonPath: () => buttonPathOf(ATTENDANCE_PATH),
  buttonLabel: OPEN_ROVIQ,
  example: ATTENDANCE_EXAMPLE,
};

const whatsappDigest: WhatsAppTemplate<readonly AttendanceAbsentParams[]> = {
  name: 'attendance_absent_digest_v1',
  category: MessageTemplateCategory.UTILITY,
  body: {
    en: 'Attendance summary for {{1}}: today {{2}} absent and {{3}} late marks were recorded. Open Roviq to see the details.',
    hi: 'उपस्थिति सारांश, {{1}}: आज {{2}} अनुपस्थिति और {{3}} विलंब दर्ज हुए। विवरण के लिए Roviq खोलें।',
  },
  variables: (items, locale) => {
    const late = items.filter((p) => p.status === 'LATE').length;
    return [
      nameList(
        items.map((p) => p.studentName),
        locale === 'hi' ? 'आपका बच्चा' : 'your ward',
        locale,
      ),
      String(items.length - late),
      String(late),
    ];
  },
  buttonPath: () => buttonPathOf(ATTENDANCE_PATH),
  buttonLabel: OPEN_ROVIQ,
  example: [
    ATTENDANCE_EXAMPLE,
    { ...ATTENDANCE_EXAMPLE, studentName: 'Diya Sharma', status: 'LATE' },
  ],
};

export const attendanceAbsentWhatsApp: TypeTemplates<AttendanceAbsentParams> = {
  single: whatsappSingle,
  digest: whatsappDigest,
};

function summary(
  items: readonly AttendanceAbsentParams[],
  channel: NotificationChannel,
  locale: Locale,
): OutsideCopy {
  const [first] = items;
  const one = items.length === 1 && first ? first : null;
  if (channel === 'WHATSAPP') {
    return {
      subject: locale === 'hi' ? 'उपस्थिति सूचना' : 'Attendance Alert',
      body: one
        ? renderTemplate(whatsappSingle.body[locale], whatsappSingle.variables(one, locale))
        : renderTemplate(whatsappDigest.body[locale], whatsappDigest.variables(items, locale)),
    };
  }
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

/**
 * One alert per session, student and status, however often the entry is re-marked. The event key:
 * each guardian's in-app row adds their user id to it.
 */
export function attendanceAbsentDedupeKey(
  p: Pick<AttendanceAbsentParams, 'sessionId' | 'studentId' | 'status'>,
): string {
  return `attendance:${p.sessionId}:${p.studentId}:${p.status}`;
}

export const attendanceAbsentType: RegularNotificationType<AttendanceAbsentParams> = {
  key: 'ATTENDANCE_ABSENT',
  secret: false,
  settingsCategory: 'ATTENDANCE',
  critical: false,
  flow: guardianAlertFlow(),
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
    data: { sessionId: p.sessionId, studentId: p.studentId, path: ATTENDANCE_PATH },
  }),
  outsideCopy: (p, channel, locale) => summary([p], channel, locale),
};
