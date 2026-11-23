import { NOTIFICATION_TYPE_VALUES } from '@roviq/common-types';
import { describe, expect, it, vi } from 'vitest';
import {
  composeDigest,
  composeInApp,
  composeOutside,
  composeSecret,
  type RegularMessage,
} from '../compose';
import { LOCALES } from '../notification-type';
import { REGULAR_TYPES, type RegularPayload, type RegularTypeKey, SECRET_TYPES } from '../registry';

const SAMPLES: { [K in RegularTypeKey]: RegularMessage<K> } = {
  ATTENDANCE_ABSENT: {
    type: 'ATTENDANCE_ABSENT',
    params: {
      sessionId: 'session-1',
      studentId: 'membership-student-1',
      studentName: 'Aarav Sharma',
      status: 'ABSENT',
      markedAt: '2026-11-22T03:35:00.000Z',
      sessionDate: '2026-11-22',
      sectionName: 'A',
      standardName: 'Class 5',
    },
  },
  FEE_OVERDUE: {
    type: 'FEE_OVERDUE',
    params: {
      studentId: 'membership-student-1',
      studentName: 'Aarav Sharma',
      feeId: 'fee-1',
      amount: 5000,
      currency: 'INR',
      dueDate: '2026-04-10',
      daysOverdue: 12,
      feeType: 'Tuition',
    },
  },
  FEE_REMINDER: {
    type: 'FEE_REMINDER',
    params: {
      studentId: 'membership-student-1',
      studentName: 'Aarav Sharma',
      feeId: 'fee-1',
      amount: 5000,
      currency: 'INR',
      dueDate: '2026-04-10',
      feeType: 'Tuition',
      feePeriod: 'April 2026',
    },
  },
  LEAVE_DECIDED: {
    type: 'LEAVE_DECIDED',
    params: {
      leaveId: 'leave-1',
      status: 'APPROVED',
      audience: 'guardian',
      applicantName: 'Ishaan Kapoor',
      startDate: '2026-11-24',
      endDate: '2026-11-26',
    },
  },
  APPROVAL_REQUESTED: {
    type: 'APPROVAL_REQUESTED',
    params: {
      approvalType: 'Leave',
      requesterName: 'Priya Verma',
      summary: 'Two days, family function',
      entityId: 'leave-1',
    },
  },
  APPROVAL_RESOLVED: {
    type: 'APPROVAL_RESOLVED',
    params: { approvalType: 'Leave', status: 'REJECTED', reviewerName: 'Principal', remarks: null },
  },
  AUTH_LOGIN: {
    type: 'AUTH_LOGIN',
    params: {
      ip: '203.0.113.7',
      at: '2026-11-22T12:47:00.000Z',
      accountPath: '/institute/account',
    },
  },
  AUTH_PASSWORD_RESET: {
    type: 'AUTH_PASSWORD_RESET',
    params: { ip: null, at: '2026-04-10T04:30:00.000Z', accountPath: '/institute/account' },
  },
  AUTH_NEW_DEVICE: {
    type: 'AUTH_NEW_DEVICE',
    params: { ip: '203.0.113.7', at: '2026-04-10T04:30:00.000Z', accountPath: '/reseller/account' },
  },
  AUTH_ACCOUNT_LOCKED: {
    type: 'AUTH_ACCOUNT_LOCKED',
    params: { ip: '203.0.113.7', at: '2026-04-10T04:30:00.000Z', accountPath: '/admin/account' },
  },
  AUTH_SESSION_REVOKED: {
    type: 'AUTH_SESSION_REVOKED',
    params: { ip: null, at: '2026-04-10T04:30:00.000Z', accountPath: '/institute/account' },
  },
  BILLING_EVENT: {
    type: 'BILLING_EVENT',
    params: {
      kind: 'payment-failed',
      subscriptionId: 'subscription-1',
      instituteId: 'institute-1',
      planName: 'Standard',
      planAmount: 99900,
      planCurrency: 'INR',
    },
  },
};

const DEVANAGARI = /[ऀ-ॿ]/;

describe('notification type registry', () => {
  it('should cover every notification type exactly once', () => {
    const keys = [...Object.keys(SECRET_TYPES), ...Object.keys(REGULAR_TYPES)].sort();

    expect(keys).toEqual([...NOTIFICATION_TYPE_VALUES].sort());
  });

  it('should key every type module under its own key', () => {
    for (const [key, type] of Object.entries(SECRET_TYPES)) expect(type.key).toBe(key);
    for (const [key, type] of Object.entries(REGULAR_TYPES)) expect(type.key).toBe(key);
  });
});

describe('regular type copy', () => {
  const samples: RegularPayload[] = Object.values(SAMPLES);

  it.each(
    samples.map((s) => [s.type, s] as const),
  )('%s has English and Hindi in-app copy', (_key, sample) => {
    const copy = composeInApp(sample);

    expect(copy.title.en).not.toBe('');
    expect(copy.body.en).not.toBe('');
    expect(copy.title.hi).toMatch(DEVANAGARI);
    expect(copy.body.hi).toMatch(DEVANAGARI);
    expect(typeof copy.data.path).toBe('string');
  });

  it.each(
    samples.map((s) => [s.type, s] as const),
  )('%s has outside copy for each of its channels in both locales', (_key, sample) => {
    for (const channel of REGULAR_TYPES[sample.type].channels) {
      const en = composeOutside(sample, channel, 'en');
      const hi = composeOutside(sample, channel, 'hi');

      expect(en.body).not.toBe('');
      // A push body may be only names and tenant text; its title carries the Hindi.
      expect(`${hi.subject} ${hi.body}`).toMatch(DEVANAGARI);
      if (channel === 'EMAIL') {
        expect(en.subject).not.toBe('');
        expect(hi.subject).not.toBe('');
      }
    }
  });

  it('should word a single absence for the guardian in each locale', () => {
    const sample = SAMPLES.ATTENDANCE_ABSENT;

    expect(composeInApp(sample)).toEqual({
      title: { en: 'Absence recorded', hi: 'अनुपस्थिति दर्ज' },
      body: {
        en: 'Your ward Aarav Sharma (Class 5-A) was marked absent on 22 November 2026. Please contact the institute if this is incorrect.',
        hi: '22 नवंबर 2026 को आपके बच्चे Aarav Sharma (Class 5-A) को अनुपस्थित दर्ज किया गया। यदि यह सही नहीं है तो कृपया संस्थान से संपर्क करें।',
      },
      data: {
        sessionId: 'session-1',
        studentId: 'membership-student-1',
        path: '/institute/attendance',
      },
    });
    expect(composeOutside(sample, 'EMAIL', 'en')).toEqual({
      subject: 'Attendance alert: Aarav Sharma was absent',
      body: 'Your ward Aarav Sharma (Class 5-A) was marked absent on 22 November 2026.',
    });
    expect(composeOutside(sample, 'EMAIL', 'hi')).toEqual({
      subject: 'उपस्थिति सूचना: Aarav Sharma अनुपस्थित',
      body: '22 नवंबर 2026 को आपके बच्चे Aarav Sharma (Class 5-A) को अनुपस्थित दर्ज किया गया।',
    });
    expect(composeOutside(sample, 'WHATSAPP', 'hi')).toEqual({
      subject: 'उपस्थिति सूचना',
      body: 'उपस्थिति सूचना: Aarav Sharma (Class 5-A) को अनुपस्थित दर्ज किया गया। तिथि: 22 नवंबर 2026।',
    });
  });

  it('should word a late arrival with only a section, and without a name', () => {
    const late: RegularMessage<'ATTENDANCE_ABSENT'> = {
      type: 'ATTENDANCE_ABSENT',
      params: {
        ...SAMPLES.ATTENDANCE_ABSENT.params,
        studentName: null,
        status: 'LATE',
        standardName: null,
      },
    };

    expect(composeOutside(late, 'EMAIL', 'en')).toEqual({
      subject: 'Attendance alert: your ward was late',
      body: 'Your ward (Section A) was marked late on 22 November 2026.',
    });
    expect(composeOutside(late, 'EMAIL', 'hi')).toEqual({
      subject: 'उपस्थिति सूचना: आपका बच्चा विलंब से उपस्थित',
      body: '22 नवंबर 2026 को आपके बच्चे (सेक्शन A) को विलंब से उपस्थित दर्ज किया गया।',
    });
  });

  it('should leave the date out, never print a timestamp, when the session date is missing or invalid', () => {
    for (const sessionDate of [null, '2026-02-30', '2026-11-22T03:35:00.000Z']) {
      const message: RegularMessage<'ATTENDANCE_ABSENT'> = {
        type: 'ATTENDANCE_ABSENT',
        params: { ...SAMPLES.ATTENDANCE_ABSENT.params, sessionDate, sectionName: null },
      };

      expect(composeInApp(message).body).toEqual({
        en: 'Your ward Aarav Sharma was marked absent. Please contact the institute if this is incorrect.',
        hi: 'आपके बच्चे Aarav Sharma को अनुपस्थित दर्ज किया गया। यदि यह सही नहीं है तो कृपया संस्थान से संपर्क करें।',
      });
    }
  });

  it('should keep a calendar date on its own day west of UTC', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const message: RegularMessage<'ATTENDANCE_ABSENT'> = {
      type: 'ATTENDANCE_ABSENT',
      params: { ...SAMPLES.ATTENDANCE_ABSENT.params, sessionDate: '2026-01-01' },
    };

    try {
      expect(composeOutside(message, 'WHATSAPP', 'en').body).toBe(
        'Attendance update: Aarav Sharma (Class 5-A) was marked absent. Date: 1 January 2026.',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('should summarise several absences in one digest', () => {
    const items = [
      SAMPLES.ATTENDANCE_ABSENT.params,
      { ...SAMPLES.ATTENDANCE_ABSENT.params, status: 'LATE' as const },
    ];

    expect(composeDigest({ type: 'ATTENDANCE_ABSENT', items }, 'EMAIL', 'en')).toEqual({
      subject: 'Attendance alerts: 1 absence, 1 late arrival',
      body: '2 attendance alerts were recorded today.',
    });
    expect(composeDigest({ type: 'ATTENDANCE_ABSENT', items }, 'EMAIL', 'hi')).toEqual({
      subject: 'उपस्थिति सूचनाएँ: 1 अनुपस्थिति, 1 विलंब',
      body: 'आज उपस्थिति की 2 सूचनाएँ दर्ज हुईं।',
    });
    expect(composeDigest({ type: 'ATTENDANCE_ABSENT', items }, 'PUSH', 'hi')).toEqual({
      subject: 'उपस्थिति सूचना',
      body: 'आज उपस्थिति की 2 सूचनाएँ दर्ज हुईं।',
    });
  });

  it('should count absences in the plural in a digest of absences only', () => {
    const items = [SAMPLES.ATTENDANCE_ABSENT.params, SAMPLES.ATTENDANCE_ABSENT.params];

    expect(composeDigest({ type: 'ATTENDANCE_ABSENT', items }, 'EMAIL', 'en').subject).toBe(
      'Attendance alerts: 2 absences',
    );
  });

  it('should word a leave decision for a guardian with the name and dates, never the id', () => {
    const sample = SAMPLES.LEAVE_DECIDED;

    expect(composeInApp(sample)).toEqual({
      title: { en: "Ishaan Kapoor's leave was approved", hi: 'Ishaan Kapoor की छुट्टी स्वीकृत हुई' },
      body: {
        en: "Ishaan Kapoor's leave application from 24 November 2026 to 26 November 2026 has been approved.",
        hi: 'Ishaan Kapoor का 24 नवंबर 2026 से 26 नवंबर 2026 तक का छुट्टी आवेदन स्वीकृत कर दिया गया है।',
      },
      data: { leaveId: 'leave-1', path: '/institute/leave' },
    });
  });

  it('should word a one-day leave decision for the applicant', () => {
    const message: RegularMessage<'LEAVE_DECIDED'> = {
      type: 'LEAVE_DECIDED',
      params: {
        ...SAMPLES.LEAVE_DECIDED.params,
        audience: 'applicant',
        status: 'REJECTED',
        endDate: '2026-11-24',
      },
    };

    expect(composeOutside(message, 'EMAIL', 'en')).toEqual({
      subject: 'Your leave was rejected',
      body: 'Your leave application for 24 November 2026 has been rejected.',
    });
    expect(composeOutside(message, 'EMAIL', 'hi')).toEqual({
      subject: 'आपकी छुट्टी अस्वीकृत हुई',
      body: 'आपका 24 नवंबर 2026 का छुट्टी आवेदन अस्वीकृत कर दिया गया है।',
    });
  });

  it('should word a leave decision without name or dates when the event has none', () => {
    const message: RegularMessage<'LEAVE_DECIDED'> = {
      type: 'LEAVE_DECIDED',
      params: {
        leaveId: '01a202dc-0000-7000-8000-000000000001',
        status: 'REJECTED',
        audience: 'guardian',
        applicantName: null,
        startDate: null,
        endDate: null,
      },
    };

    expect(composeInApp(message)).toEqual({
      title: { en: "Your ward's leave was rejected", hi: 'आपके बच्चे की छुट्टी अस्वीकृत हुई' },
      body: {
        en: "Your ward's leave application has been rejected.",
        hi: 'आपके बच्चे का छुट्टी आवेदन अस्वीकृत कर दिया गया है।',
      },
      data: { leaveId: '01a202dc-0000-7000-8000-000000000001', path: '/institute/leave' },
    });
  });

  it('should refuse a digest for a type that declares none', () => {
    expect(() =>
      composeDigest({ type: 'FEE_REMINDER', items: [SAMPLES.FEE_REMINDER.params] }, 'EMAIL', 'en'),
    ).toThrow('Notification type FEE_REMINDER has no digest');
  });

  it('should word a sign-in with a 12-hour clock in English and a 24-hour clock in Hindi', () => {
    expect(composeInApp(SAMPLES.AUTH_LOGIN)).toEqual({
      title: { en: 'New sign-in to your account', hi: 'आपके खाते में नया साइन-इन' },
      body: {
        en: "A new sign-in was detected from IP 203.0.113.7 at 22 Nov 2026, 6:17 pm. If this wasn't you, secure your account immediately.",
        hi: '22 नव॰ 2026, 18:17 पर IP 203.0.113.7 से नया साइन-इन हुआ। यदि यह आप नहीं थे, तो तुरंत अपना खाता सुरक्षित करें।',
      },
      data: { path: '/institute/account' },
    });
  });

  it('should word a new-device email with the same clocks', () => {
    const sample = SAMPLES.AUTH_NEW_DEVICE;

    expect(composeOutside(sample, 'EMAIL', 'en')).toEqual({
      subject: 'New device sign-in',
      body: "Your account was accessed from a new device at 10 Apr 2026, 10:00 am (IP: 203.0.113.7). If this wasn't you, secure your account.",
    });
    expect(composeOutside(sample, 'EMAIL', 'hi')).toEqual({
      subject: 'नए उपकरण से साइन-इन',
      body: '10 अप्रैल 2026, 10:00 पर एक नए उपकरण से आपके खाते में प्रवेश हुआ (IP: 203.0.113.7)। यदि यह आप नहीं थे, तो अपना खाता सुरक्षित करें।',
    });
  });

  it('should keep the sign-in alert in the app and the other security alerts on their channels', () => {
    expect(REGULAR_TYPES.AUTH_LOGIN.channels).toEqual([]);
    expect(REGULAR_TYPES.AUTH_PASSWORD_RESET.channels).toEqual(['EMAIL', 'WHATSAPP', 'PUSH']);
    expect(REGULAR_TYPES.AUTH_NEW_DEVICE.channels).toEqual(['EMAIL', 'WHATSAPP', 'PUSH']);
    expect(REGULAR_TYPES.AUTH_ACCOUNT_LOCKED.channels).toEqual(['EMAIL', 'PUSH']);
    expect(REGULAR_TYPES.AUTH_SESSION_REVOKED.channels).toEqual(['EMAIL', 'PUSH']);
  });

  it('should mark only the security alerts and billing events as critical', () => {
    const critical = Object.values(REGULAR_TYPES)
      .filter((t) => t.critical)
      .map((t) => t.key)
      .sort();

    expect(critical).toEqual([
      'AUTH_ACCOUNT_LOCKED',
      'AUTH_LOGIN',
      'AUTH_NEW_DEVICE',
      'AUTH_PASSWORD_RESET',
      'AUTH_SESSION_REVOKED',
      'BILLING_EVENT',
    ]);
  });
});

describe('secret types', () => {
  it('should send codes and passwords only on their allowed channels', () => {
    expect(SECRET_TYPES.EMAIL_VERIFICATION.channels).toEqual(['EMAIL']);
    expect(SECRET_TYPES.IMPERSONATION_OTP.channels).toEqual(['SMS', 'EMAIL']);
    expect(SECRET_TYPES.USER_WELCOME.channels).toEqual(['EMAIL', 'SMS']);
  });

  it('should expose no in-app copy, settings category or digest', () => {
    for (const type of Object.values(SECRET_TYPES)) {
      expect(Object.keys(type).sort()).toEqual(['channels', 'key', 'outsideCopy', 'secret']);
      expect(type.secret).toBe(true);
    }
  });

  it('should put the code into each channel copy in both locales', () => {
    for (const locale of LOCALES) {
      expect(
        composeSecret('EMAIL_VERIFICATION', { code: '482913' }, 'EMAIL', locale).body,
      ).toContain('482913');
      for (const channel of SECRET_TYPES.IMPERSONATION_OTP.channels) {
        expect(
          composeSecret('IMPERSONATION_OTP', { otp: '771204' }, channel, locale).body,
        ).toContain('771204');
      }
    }
  });

  it('should ask the institute to give the impersonation code to Roviq support', () => {
    const params = { otp: '771204' };

    expect(composeSecret('IMPERSONATION_OTP', params, 'SMS', 'en')).toEqual({
      subject: '',
      body: 'Roviq: Someone from Roviq support has asked to view your institute as one of its users. If you approve, give them this code: 771204. It expires in 5 minutes. If you did not expect this, ignore this message and nothing will happen.',
    });
    expect(composeSecret('IMPERSONATION_OTP', params, 'SMS', 'hi')).toEqual({
      subject: '',
      body: 'Roviq: Roviq सपोर्ट से किसी ने आपके संस्थान को उसके एक उपयोगकर्ता के रूप में देखने की अनुमति माँगी है। यदि आप अनुमति देते हैं, तो उन्हें यह कोड दें: 771204। यह 5 मिनट में समाप्त हो जाएगा। यदि आपको इसकी अपेक्षा नहीं थी, तो इस संदेश को अनदेखा करें, कुछ नहीं होगा।',
    });
    expect(composeSecret('IMPERSONATION_OTP', params, 'EMAIL', 'en')).toEqual({
      subject: 'Roviq support asks to view your institute',
      body: [
        'Someone from Roviq support has asked to view your institute as one of its users.',
        '',
        'If you approve, give them this code: 771204',
        'It expires in 5 minutes.',
        '',
        'If you did not expect this, ignore this email and nothing will happen.',
      ].join('\n'),
    });
    expect(composeSecret('IMPERSONATION_OTP', params, 'EMAIL', 'hi')).toEqual({
      subject: 'Roviq सपोर्ट आपके संस्थान को देखने की अनुमति माँग रहा है',
      body: [
        'Roviq सपोर्ट से किसी ने आपके संस्थान को उसके एक उपयोगकर्ता के रूप में देखने की अनुमति माँगी है।',
        '',
        'यदि आप अनुमति देते हैं, तो उन्हें यह कोड दें: 771204',
        'यह 5 मिनट में समाप्त हो जाएगा।',
        '',
        'यदि आपको इसकी अपेक्षा नहीं थी, तो इस ईमेल को अनदेखा करें, कुछ नहीं होगा।',
      ].join('\n'),
    });
  });

  it('should word the welcome email with the username and temporary password', () => {
    const params = {
      username: 'priya.verma',
      firstName: 'Priya',
      tempPassword: 'Tmp-9xQ2',
      institute: null,
    };

    expect(composeSecret('USER_WELCOME', params, 'EMAIL', 'en')).toEqual({
      subject: 'Welcome to Roviq — your account is ready',
      body: [
        'Hi Priya,',
        '',
        'Your Roviq account has been set up.',
        'Username: priya.verma',
        'Temporary password: Tmp-9xQ2',
        '',
        'Log in and change your password on first sign-in.',
      ].join('\n'),
    });
    expect(composeSecret('USER_WELCOME', params, 'SMS', 'hi')).toEqual({
      subject: '',
      body: 'Roviq: खाता तैयार है। यूज़रनेम: priya.verma | अस्थायी पासवर्ड: Tmp-9xQ2। पहली बार लॉग इन करते समय इसे बदलें।',
    });
  });

  it('should name the institute and its sign-in address in a welcome it created (ROV-315)', () => {
    const params = {
      username: 'staff-0191-ab12',
      firstName: 'Kiran',
      tempPassword: 'Tmp-7kP4',
      institute: {
        name: { en: 'Sunrise Public', hi: 'सनराइज़ पब्लिक' },
        signInUrl: 'https://app.roviq.com/login',
      },
    };

    expect(composeSecret('USER_WELCOME', params, 'EMAIL', 'en')).toEqual({
      subject: 'Your Roviq sign-in details for Sunrise Public',
      body: [
        'Hi Kiran,',
        '',
        'Sunrise Public has created a Roviq account for you.',
        'Username: staff-0191-ab12',
        'Temporary password: Tmp-7kP4',
        '',
        'Sign in at https://app.roviq.com/login. You will be asked to choose your own password the first time.',
        'If you did not expect this, contact Sunrise Public.',
      ].join('\n'),
    });
    expect(composeSecret('USER_WELCOME', params, 'EMAIL', 'hi')).toEqual({
      subject: 'सनराइज़ पब्लिक के लिए आपके Roviq साइन-इन विवरण',
      body: [
        'नमस्ते Kiran,',
        '',
        'सनराइज़ पब्लिक ने Roviq पर आपके लिए एक खाता बनाया है।',
        'यूज़रनेम: staff-0191-ab12',
        'अस्थायी पासवर्ड: Tmp-7kP4',
        '',
        'https://app.roviq.com/login पर साइन इन करें। पहली बार साइन इन करते समय आपसे अपना पासवर्ड बनाने को कहा जाएगा।',
        'यदि आपको इसकी अपेक्षा नहीं थी, तो सनराइज़ पब्लिक से संपर्क करें।',
      ].join('\n'),
    });
    expect(composeSecret('USER_WELCOME', params, 'SMS', 'en')).toEqual({
      subject: '',
      body: 'Roviq: Sunrise Public created your account. Username: staff-0191-ab12 | Temp password: Tmp-7kP4. Sign in at https://app.roviq.com/login and set your own password.',
    });
    expect(
      composeSecret(
        'USER_WELCOME',
        { ...params, institute: { ...params.institute, name: { en: 'Sunrise Public' } } },
        'SMS',
        'hi',
      ).body,
    ).toBe(
      'Roviq: Sunrise Public ने आपका खाता बनाया है। यूज़रनेम: staff-0191-ab12 | अस्थायी पासवर्ड: Tmp-7kP4। https://app.roviq.com/login पर साइन इन करें और अपना पासवर्ड बनाएँ।',
    );
  });
});
