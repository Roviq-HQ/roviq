import { formatCalendarDate } from './calendar-date';
import { guardianAlertFlow } from './flow';
import { type Locale, localized, type RegularNotificationType } from './notification-type';

export interface LeaveDecidedParams {
  leaveId: string;
  status: 'APPROVED' | 'REJECTED';
  /** The applicant, or a guardian of a student applicant. */
  audience: 'applicant' | 'guardian';
  /** Null when the event has none; the copy then says "your ward". */
  applicantName: string | null;
  /** `YYYY-MM-DD`; the copy leaves the dates out when either is missing. */
  startDate: string | null;
  endDate: string | null;
}

function decided(status: LeaveDecidedParams['status'], locale: Locale): string {
  if (locale === 'hi') return status === 'APPROVED' ? 'अप्रूव' : 'रिजेक्ट';
  return status === 'APPROVED' ? 'approved' : 'rejected';
}

/** "for 24 November 2026" / "from … to …", or null when the dates are unknown. */
function period(p: LeaveDecidedParams, locale: Locale): string | null {
  const start = formatCalendarDate(p.startDate, locale);
  const end = formatCalendarDate(p.endDate, locale);
  if (!start || !end) return null;
  if (locale === 'hi') return start === end ? `${start} का` : `${start} से ${end} तक का`;
  return start === end ? `for ${start}` : `from ${start} to ${end}`;
}

function subject(p: LeaveDecidedParams, locale: Locale): string {
  const word = decided(p.status, locale);
  if (p.audience === 'guardian') {
    if (p.applicantName) {
      return locale === 'hi'
        ? `${p.applicantName} की छुट्टी ${word} हुई`
        : `${p.applicantName}'s leave was ${word}`;
    }
    return locale === 'hi' ? `आपके बच्चे की छुट्टी ${word} हुई` : `Your ward's leave was ${word}`;
  }
  return locale === 'hi' ? `आपकी छुट्टी ${word} हुई` : `Your leave was ${word}`;
}

function body(p: LeaveDecidedParams, locale: Locale): string {
  const word = decided(p.status, locale);
  const when = period(p, locale);
  if (locale === 'hi') {
    const whose =
      p.audience === 'guardian'
        ? p.applicantName
          ? `${p.applicantName} का`
          : 'आपके बच्चे का'
        : 'आपका';
    return `${[whose, when, 'छुट्टी ऐप्लिकेशन'].filter(Boolean).join(' ')} ${word} कर दिया गया है।`;
  }
  const whose =
    p.audience === 'guardian' ? (p.applicantName ? `${p.applicantName}'s` : "Your ward's") : 'Your';
  return `${[whose, 'leave application', when].filter(Boolean).join(' ')} has been ${word}.`;
}

export const leaveDecidedType: RegularNotificationType<LeaveDecidedParams> = {
  key: 'LEAVE_DECIDED',
  secret: false,
  // Leave decisions follow the institute's approval settings.
  settingsCategory: 'APPROVAL',
  critical: false,
  flow: guardianAlertFlow(),
  digest: null,
  inAppCopy: (p) => ({
    title: localized((l) => subject(p, l)),
    body: localized((l) => body(p, l)),
    data: { leaveId: p.leaveId, path: '/institute/leave' },
  }),
  outsideCopy: (p, _channel, locale) => ({ subject: subject(p, locale), body: body(p, locale) }),
};
