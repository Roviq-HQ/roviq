import { describe, expect, it } from 'vitest';
import { composeDigest, composeInApp, composeOutside } from '../../../types/compose';
import { deliveryCanaryWhatsApp } from '../../../types/delivery-canary.type';
import { channelsOf } from '../../../types/flow';
import { LOCALES, type Locale } from '../../../types/notification-type';
import { REGULAR_TYPES, type RegularParamsMap, type RegularTypeKey } from '../../../types/registry';
import {
  placeholdersOf,
  renderTemplate,
  templateBodyProblems,
  type WhatsAppTemplate,
} from '../whatsapp-template';
import {
  WHATSAPP_TEMPLATES,
  whatsappDigestTemplateFor,
  whatsappTemplateFor,
} from '../whatsapp-templates';

/** One fully filled param set and one with every nullable or free-text field missing. */
const SAMPLES: { [K in RegularTypeKey]?: readonly [RegularParamsMap[K], RegularParamsMap[K]] } = {
  ATTENDANCE_ABSENT: [
    {
      sessionId: 'session-1',
      studentId: 'membership-student-1',
      studentName: 'Aarav Sharma',
      status: 'ABSENT',
      markedAt: '2026-11-22T03:35:00.000Z',
      sessionDate: '2026-11-22',
      sectionName: 'A',
      standardName: 'Class 5',
    },
    {
      sessionId: 'session-2',
      studentId: 'membership-student-2',
      studentName: null,
      status: 'LATE',
      markedAt: '2026-11-22T03:35:00.000Z',
      sessionDate: null,
      sectionName: null,
      standardName: null,
    },
  ],
  FEE_OVERDUE: [
    {
      studentId: 'membership-student-1',
      studentName: 'Aarav Sharma',
      feeId: 'fee-1',
      amount: 5000,
      currency: 'INR',
      dueDate: '2026-04-10',
      daysOverdue: 12,
      feeType: 'Tuition',
    },
    {
      studentId: 'membership-student-2',
      studentName: '',
      feeId: 'fee-2',
      amount: 0,
      currency: '',
      dueDate: '',
      daysOverdue: 0,
      feeType: ' ',
    },
  ],
  FEE_REMINDER: [
    {
      studentId: 'membership-student-1',
      studentName: 'Aarav Sharma',
      feeId: 'fee-1',
      amount: 5000,
      currency: 'INR',
      dueDate: '2026-04-10',
      feeType: 'Tuition',
      feePeriod: 'April 2026',
    },
    {
      studentId: 'membership-student-2',
      studentName: '',
      feeId: 'fee-2',
      amount: 0,
      currency: '',
      dueDate: '',
      feeType: '',
      feePeriod: '',
    },
  ],
  APPROVAL_REQUESTED: [
    {
      approvalType: 'LEAVE',
      requesterName: 'Priya Verma',
      summary: 'Two days,\nfamily  function.',
      entityId: 'leave-1',
    },
    { approvalType: '', requesterName: '', summary: ' \n\t ', entityId: 'entity-2' },
  ],
  APPROVAL_RESOLVED: [
    {
      approvalType: 'LEAVE',
      status: 'APPROVED',
      reviewerName: 'Principal',
      remarks: 'Enjoy\tthe break',
    },
    { approvalType: '', status: 'REJECTED', reviewerName: '', remarks: null },
  ],
  AUTH_PASSWORD_RESET: [
    { ip: '203.0.113.7', at: '2026-04-10T04:30:00.000Z', accountPath: '/reseller/account' },
    { ip: null, at: '2026-04-10T04:30:00.000Z', accountPath: '/institute/account' },
  ],
  AUTH_NEW_DEVICE: [
    { ip: '203.0.113.7', at: '2026-04-10T04:30:00.000Z', accountPath: '/admin/account' },
    { ip: null, at: '2026-04-10T04:30:00.000Z', accountPath: '/institute/account' },
  ],
};

function isRegularKey(key: string): key is RegularTypeKey {
  return key in REGULAR_TYPES;
}

const ALL_KEYS = Object.keys(REGULAR_TYPES).filter(isRegularKey);
const onWhatsApp = (k: RegularTypeKey) => channelsOf(REGULAR_TYPES[k].flow).includes('WHATSAPP');
// In the guardian flow, but with no approved template yet: its WhatsApp step records no_template.
const NO_TEMPLATE_YET: readonly RegularTypeKey[] = ['LEAVE_DECIDED'];
const WHATSAPP_KEYS = ALL_KEYS.filter((k) => onWhatsApp(k) && !NO_TEMPLATE_YET.includes(k));
const OTHER_KEYS = ALL_KEYS.filter((k) => !onWhatsApp(k));

/** What the provider reviews; the same for a template of any params. */
type ApprovedText = Pick<WhatsAppTemplate<null>, 'name' | 'category' | 'body'>;

const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*_v1$/;
const EMOJI = /\p{Extended_Pictographic}/u;
const ASKS_FOR_REPLY = /\b(reply|respond|write back|message us|text us)\b|जवाब|उत्तर दें/i;

function samplesOf<K extends RegularTypeKey>(
  key: K,
): readonly [RegularParamsMap[K], RegularParamsMap[K]] {
  const samples = SAMPLES[key];
  if (!samples) throw new Error(`No sample params for ${key}`);
  return samples;
}

function fiveOf<P>(samples: readonly P[]): P[] {
  return Array.from({ length: 5 }, (_, i) => samples[i % samples.length]).filter(
    (p): p is P => p !== undefined,
  );
}

function inAppPath<K extends RegularTypeKey>(key: K, params: RegularParamsMap[K]): string {
  const path = composeInApp({ type: key, params }).data.path;
  if (typeof path !== 'string') throw new Error(`${key} has no in-app path`);
  return path;
}

function expectApprovedBody(template: ApprovedText): void {
  const n = placeholdersOf(template.body.en).length;
  expect(n).toBeGreaterThan(0);
  for (const locale of LOCALES) {
    const body = template.body[locale];
    expect(placeholdersOf(body)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(body).not.toMatch(/^\s*\{\{/);
    expect(body).not.toMatch(/\}\}\s*$/);
    expect(body).not.toMatch(/\}\}\s*\{\{/);
    expect(body).not.toMatch(/[\r\n]/);
    expect(body).not.toMatch(EMOJI);
    expect(body).not.toMatch(ASKS_FOR_REPLY);
  }
}

function expectSendableVariables(variables: string[], body: string): void {
  expect(variables).toHaveLength(placeholdersOf(body).length);
  for (const value of variables) {
    expect(value).not.toBe('');
    expect(value).not.toMatch(/[\r\n\t]| {2}/);
    expect(value.length).toBeLessThanOrEqual(200);
  }
  expect(renderTemplate(body, variables)).not.toMatch(/\{\{\d+\}\}/);
}

function templatesOf(): ApprovedText[] {
  return Object.values(WHATSAPP_TEMPLATES).flatMap((t) =>
    t.digest ? [t.single, t.digest] : [t.single],
  );
}

describe('WhatsApp template registry', () => {
  it('should have a single template for every type that may send on WhatsApp', () => {
    expect(WHATSAPP_KEYS.length).toBeGreaterThan(0);
    for (const key of WHATSAPP_KEYS) expect(WHATSAPP_TEMPLATES[key]?.single).toBeDefined();
  });

  it('should have a digest template exactly for the WhatsApp types with a digest', () => {
    for (const key of WHATSAPP_KEYS) {
      expect(WHATSAPP_TEMPLATES[key]?.digest !== undefined).toBe(
        REGULAR_TYPES[key].digest !== null,
      );
    }
  });

  it('should have no template for a type that never sends on WhatsApp', () => {
    for (const key of OTHER_KEYS) expect(WHATSAPP_TEMPLATES[key]).toBeUndefined();
  });

  it('should list as waiting for a template only WhatsApp types that have none', () => {
    for (const key of NO_TEMPLATE_YET) {
      expect(onWhatsApp(key)).toBe(true);
      expect(WHATSAPP_TEMPLATES[key]).toBeUndefined();
    }
  });

  it('should register every template under a unique lower snake_case name ending in _v1', () => {
    const names = templatesOf().map((t) => t.name);

    for (const name of names) expect(name).toMatch(NAME);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should file every template as a utility message', () => {
    for (const template of templatesOf()) expect(template.category).toBe('UTILITY');
  });

  it.each(
    templatesOf().map((t) => [t.name, t] as const),
  )('%s has bodies the provider accepts in both languages', (_name, template) => {
    expectApprovedBody(template);
  });
});

describe.each(WHATSAPP_KEYS.map((k) => [k] as const))('%s on WhatsApp', (key) => {
  function check<K extends RegularTypeKey>(k: K, locale: Locale): void {
    const templates = WHATSAPP_TEMPLATES[k];
    if (!templates) throw new Error(`No template for ${k}`);
    const type = REGULAR_TYPES[k];
    for (const params of samplesOf(k)) {
      const variables = templates.single.variables(params, locale);
      expectSendableVariables(variables, templates.single.body[locale]);
      expect(templates.single.buttonPath(params)).toBe(inAppPath(k, params).replace(/^\//, ''));
      expect(templates.single.buttonPath(params)).not.toMatch(/^\//);
      expect(type.outsideCopy(params, 'WHATSAPP', locale).body).toBe(
        renderTemplate(templates.single.body[locale], variables),
      );
    }
    if (!type.digest) return;
    const { digest } = templates;
    if (!digest) throw new Error(`No digest template for ${k}`);
    const samples = samplesOf(k);
    for (const params of samples) {
      expect(composeDigest({ type: k, items: [params] }, 'WHATSAPP', locale).body).toBe(
        renderTemplate(templates.single.body[locale], templates.single.variables(params, locale)),
      );
    }
    const five = fiveOf(samples);
    const variables = digest.variables(five, locale);
    expectSendableVariables(variables, digest.body[locale]);
    for (const params of five) {
      expect(digest.buttonPath(five)).toBe(inAppPath(k, params).replace(/^\//, ''));
    }
    expect(composeDigest({ type: k, items: five }, 'WHATSAPP', locale).body).toBe(
      renderTemplate(digest.body[locale], variables),
    );
  }

  it.each(
    LOCALES.map((l) => [l] as const),
  )('should send the approved %s template with clean variables and the in-app path', (locale) => {
    check(key, locale);
  });
});

describe('whatsappTemplateFor', () => {
  it('should return null for a type without a template', () => {
    expect(
      whatsappTemplateFor(
        {
          type: 'LEAVE_DECIDED',
          params: {
            leaveId: 'leave-1',
            status: 'APPROVED',
            audience: 'guardian',
            applicantName: null,
            startDate: null,
            endDate: null,
          },
        },
        'en',
      ),
    ).toBeNull();
  });

  it('should name the attendance template with its variables and button path', () => {
    const [full, sparse] = samplesOf('ATTENDANCE_ABSENT');

    expect(whatsappTemplateFor({ type: 'ATTENDANCE_ABSENT', params: full }, 'en')).toEqual({
      name: 'attendance_absent_v1',
      languageCode: 'en',
      category: 'UTILITY',
      bodyVariables: ['Aarav Sharma', 'Class 5-A', 'absent', '22 November 2026'],
      buttonPath: 'institute/attendance',
    });
    expect(whatsappTemplateFor({ type: 'ATTENDANCE_ABSENT', params: sparse }, 'hi')).toEqual({
      name: 'attendance_absent_v1',
      languageCode: 'hi',
      category: 'UTILITY',
      bodyVariables: ['आपके बच्चे', 'अपनी क्लास', 'लेट', 'आज'],
      buttonPath: 'institute/attendance',
    });
  });

  it('should open the account page of the portal a security alert belongs to', () => {
    const [full] = samplesOf('AUTH_NEW_DEVICE');

    expect(whatsappTemplateFor({ type: 'AUTH_NEW_DEVICE', params: full }, 'en')).toEqual({
      name: 'auth_new_device_v1',
      languageCode: 'en',
      category: 'UTILITY',
      bodyVariables: ['10 Apr 2026, 10:00 am', '203.0.113.7'],
      buttonPath: 'admin/account',
    });
  });

  it('should word each approved template as the recipient reads it', () => {
    const [attendance] = samplesOf('ATTENDANCE_ABSENT');
    const [overdue] = samplesOf('FEE_OVERDUE');
    const [reminder] = samplesOf('FEE_REMINDER');
    const [requested] = samplesOf('APPROVAL_REQUESTED');
    const [, resolved] = samplesOf('APPROVAL_RESOLVED');
    const [, reset] = samplesOf('AUTH_PASSWORD_RESET');

    expect(
      composeOutside({ type: 'ATTENDANCE_ABSENT', params: attendance }, 'WHATSAPP', 'en').body,
    ).toBe(
      'Attendance update for Aarav Sharma in Class 5-A: marked absent on 22 November 2026. Open Roviq to see the details.',
    );
    expect(composeOutside({ type: 'FEE_OVERDUE', params: overdue }, 'WHATSAPP', 'hi').body).toBe(
      'शुल्क बकाया: Aarav Sharma का Tuition शुल्क, राशि INR 5000, बकाया है, जिसकी देय तिथि 10 अप्रैल 2026 थी। विवरण के लिए Roviq खोलें।',
    );
    expect(composeOutside({ type: 'FEE_REMINDER', params: reminder }, 'WHATSAPP', 'en').body).toBe(
      'Fee reminder: Aarav Sharma has a fee (Tuition) of INR 5000 for April 2026, due on 10 April 2026. Open Roviq to see the details.',
    );
    expect(
      composeOutside({ type: 'APPROVAL_REQUESTED', params: requested }, 'WHATSAPP', 'en').body,
    ).toBe(
      'Approval needed: Priya Verma submitted a LEAVE request. Summary: Two days, family function. Open Roviq to review it.',
    );
    expect(
      composeOutside({ type: 'APPROVAL_RESOLVED', params: resolved }, 'WHATSAPP', 'hi').body,
    ).toBe(
      'अनुरोध अपडेट: प्रस्तुत अनुरोध की समीक्षा समीक्षक ने की और इसे रिजेक्ट किया गया। टिप्पणी: कोई नहीं। विवरण के लिए Roviq खोलें।',
    );
    expect(
      composeOutside({ type: 'AUTH_PASSWORD_RESET', params: reset }, 'WHATSAPP', 'en').body,
    ).toBe(
      'Security alert: a password reset was requested for your Roviq account at 10 Apr 2026, 10:00 am (IP: unknown). If this was not you, secure your account now.',
    );
  });
});

describe('whatsappDigestTemplateFor', () => {
  it('should return null for a type without a template', () => {
    expect(
      whatsappDigestTemplateFor(
        {
          type: 'BILLING_EVENT',
          items: [
            {
              kind: 'payment-failed',
              subscriptionId: 'subscription-1',
              instituteId: 'institute-1',
              planName: 'Standard',
              planAmount: 99900,
              planCurrency: 'INR',
            },
          ],
        },
        'en',
      ),
    ).toBeNull();
  });

  it('should use the single template for a digest of one item', () => {
    const [full] = samplesOf('FEE_OVERDUE');

    expect(whatsappDigestTemplateFor({ type: 'FEE_OVERDUE', items: [full] }, 'en')).toEqual({
      name: 'fee_overdue_v1',
      languageCode: 'en',
      category: 'UTILITY',
      bodyVariables: ['Aarav Sharma', 'Tuition', 'INR 5000', '10 April 2026'],
      buttonPath: 'institute/dashboard',
    });
  });

  it('should count several absences and late marks in one summary', () => {
    const [full, sparse] = samplesOf('ATTENDANCE_ABSENT');
    const items = [
      full,
      sparse,
      { ...full, studentName: 'Diya Rao' },
      { ...full, studentName: 'Kabir Singh', status: 'LATE' as const },
      { ...full, studentName: 'Meera Iyer' },
    ];

    expect(whatsappDigestTemplateFor({ type: 'ATTENDANCE_ABSENT', items }, 'en')).toEqual({
      name: 'attendance_absent_digest_v1',
      languageCode: 'en',
      category: 'UTILITY',
      bodyVariables: ['Aarav Sharma, Diya Rao, Kabir Singh and 1 more', '3', '2'],
      buttonPath: 'institute/attendance',
    });
    expect(composeDigest({ type: 'ATTENDANCE_ABSENT', items }, 'WHATSAPP', 'hi').body).toBe(
      'उपस्थिति सारांश, Aarav Sharma, Diya Rao, Kabir Singh और 1 अन्य: आज 3 अनुपस्थिति और 2 विलंब दर्ज हुए। विवरण के लिए Roviq खोलें।',
    );
  });

  it('should return null for several items of a type without a digest', () => {
    const [full, sparse] = samplesOf('FEE_REMINDER');

    expect(
      whatsappDigestTemplateFor({ type: 'FEE_REMINDER', items: [full, sparse] }, 'en'),
    ).toBeNull();
  });

  it('should count overdue fees in one summary', () => {
    const five = fiveOf(samplesOf('FEE_OVERDUE'));

    expect(whatsappDigestTemplateFor({ type: 'FEE_OVERDUE', items: five }, 'hi')).toEqual({
      name: 'fee_overdue_digest_v1',
      languageCode: 'hi',
      category: 'UTILITY',
      bodyVariables: ['Aarav Sharma', '5'],
      buttonPath: 'institute/dashboard',
    });
  });
});

describe("the provider's rules for a template body", () => {
  const bodies = [
    ...Object.values(WHATSAPP_TEMPLATES).flatMap((t) =>
      t.digest ? [t.single, t.digest] : [t.single],
    ),
    deliveryCanaryWhatsApp,
  ].flatMap((template) =>
    LOCALES.map((locale) => [template.name, locale, template.body[locale]] as const),
  );

  it.each(bodies)('%s (%s) would be accepted', (_name, _locale, body) => {
    expect(templateBodyProblems(body)).toEqual([]);
  });

  it('names each kind of refusal', () => {
    expect(templateBodyProblems('{{1}} was marked absent today in class')).toContain(
      'starts with a variable',
    );
    expect(templateBodyProblems('The student was marked absent. Date: {{1}}.')).toContain(
      'ends with a variable',
    );
    expect(templateBodyProblems('Fee for {{1}} ({{2}}) is due this week, please pay')).toContain(
      'two variables with no word between them',
    );
    expect(templateBodyProblems('Fee {{1}} due {{2}} now')).toContain(
      'too many variables for its length',
    );
  });
});
