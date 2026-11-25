import { defineFlow, step } from './flow';
import { type Locale, localized, type RegularNotificationType } from './notification-type';

export interface SectionCapacityWarningParams {
  sectionId: string;
  standardId: string;
  /** The names in every locale they were entered in; the copy falls back to English. */
  sectionName: Record<string, string>;
  standardName: Record<string, string>;
  currentStrength: number;
  optimal: number;
}

function nameIn(name: Record<string, string>, locale: Locale): string {
  return name[locale] || name.en || Object.values(name)[0] || '';
}

function subject(p: SectionCapacityWarningParams, locale: Locale): string {
  const section = `${nameIn(p.standardName, locale)} ${nameIn(p.sectionName, locale)}`;
  return locale === 'hi'
    ? `${section} अपनी सामान्य क्षमता तक भर गया है`
    : `${section} has reached its usual size`;
}

/**
 * What happened and which section, who it affects, what to do first, and when it ends; the
 * deep link opens the standard's sections (docs/frontend.md → "Messages that report a problem").
 */
function body(p: SectionCapacityWarningParams, locale: Locale): string {
  const section = `${nameIn(p.standardName, locale)} ${nameIn(p.sectionName, locale)}`;
  if (locale === 'hi') {
    return `${section} में अब ${p.currentStrength} विद्यार्थी हैं, जो इसकी सामान्य क्षमता ${p.optimal} के बराबर या उससे अधिक है। नए विद्यार्थी आने से पहले एक नया सेक्शन जोड़ें या कुछ विद्यार्थियों को दूसरे सेक्शन में भेजें। यह संदेश एक बार भेजा जाता है; सेक्शन ${p.optimal} से कम होकर फिर भरने पर ही दोबारा आएगा।`;
  }
  const students = p.currentStrength === 1 ? 'student' : 'students';
  return `${section} now has ${p.currentStrength} ${students}, at or above its optimal strength of ${p.optimal}. Before more students join, add a section or move some students to another section. This is sent once; it comes again only after the section drops below ${p.optimal} and fills up again.`;
}

export const sectionCapacityWarningType: RegularNotificationType<SectionCapacityWarningParams> = {
  key: 'SECTION_CAPACITY_WARNING',
  secret: false,
  settingsCategory: null,
  critical: false,
  flow: defineFlow({ steps: [step.app()] }),
  digest: null,
  inAppCopy: (p) => ({
    title: localized((l) => subject(p, l)),
    body: localized((l) => body(p, l)),
    data: {
      sectionId: p.sectionId,
      standardId: p.standardId,
      path: `/institute/academics/${p.standardId}`,
    },
  }),
  outsideCopy: (p, _channel, locale) => ({ subject: subject(p, locale), body: body(p, locale) }),
};
