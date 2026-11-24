import { fitVariables, type SmsTemplate, SmsVariableError } from '../delivery/sms/sms-template';
import { cleanVariable, renderTemplate } from '../delivery/whatsapp/whatsapp-template';
import type { Locale, SecretNotificationType } from './notification-type';

/** The text the registered template produces; unshortened when a value cannot be sent exactly. */
function smsText<P>(template: SmsTemplate<P>, params: P, locale: Locale): string {
  const values = template.variables(params, locale);
  try {
    return renderTemplate(template.body[locale], fitVariables(values, template.exactPositions));
  } catch (err) {
    if (!(err instanceof SmsVariableError)) throw err;
    // The send path refuses this message; the log provider still shows it.
    return renderTemplate(template.body[locale], values);
  }
}

export interface EmailVerificationParams {
  code: string;
}

/** SF-045: email only, to the address the event names; never SMS, push or in-app. */
export const emailVerificationType: SecretNotificationType<EmailVerificationParams> = {
  key: 'EMAIL_VERIFICATION',
  secret: true,
  channels: ['EMAIL'],
  outsideCopy: (p, _channel, locale) =>
    locale === 'hi'
      ? {
          subject: 'आपका Roviq ईमेल सत्यापन कोड',
          body: [
            `आपका सत्यापन कोड ${p.code} है।`,
            '',
            'यह 10 मिनट तक मान्य है। इसे Roviq में अपने खाता पृष्ठ पर दर्ज करें।',
            'यदि आपने यह कोड नहीं माँगा था, तो इस ईमेल को अनदेखा करें।',
          ].join('\n'),
        }
      : {
          subject: 'Your Roviq email verification code',
          body: [
            `Your verification code is ${p.code}.`,
            '',
            'It is valid for 10 minutes. Enter it on your Account page in Roviq.',
            'If you did not ask for this code, you can ignore this email.',
          ].join('\n'),
        },
};

export interface ImpersonationOtpParams {
  otp: string;
}

export const impersonationOtpSms: SmsTemplate<ImpersonationOtpParams> = {
  key: 'IMPERSONATION_OTP',
  body: {
    en: 'Roviq: Someone from Roviq support has asked to view your institute as one of its users. If you approve, give them this code: {{1}}. It expires in 5 minutes. If you did not expect this, ignore this message and nothing will happen.',
    hi: 'Roviq: Roviq सपोर्ट आपके संस्थान को एक उपयोगकर्ता के रूप में देखना चाहता है। अनुमति दें तो उन्हें यह कोड दें: {{1}}। यह 5 मिनट में समाप्त होगा। अपेक्षा न हो तो अनदेखा करें।',
  },
  variables: (p) => [p.otp],
  exactPositions: [1],
  maxSegments: { en: 2, hi: 3 },
};

/** SMS and email only: an impersonated session could read the target's in-app inbox. */
export const impersonationOtpType: SecretNotificationType<ImpersonationOtpParams> = {
  key: 'IMPERSONATION_OTP',
  secret: true,
  channels: ['SMS', 'EMAIL'],
  // The requester may be reseller staff, not an admin, and the code is read out to them:
  // the recipient enters it nowhere.
  outsideCopy: (p, channel, locale) => {
    if (channel === 'SMS') return { subject: '', body: smsText(impersonationOtpSms, p, locale) };
    return locale === 'hi'
      ? {
          subject: 'Roviq सपोर्ट आपके संस्थान को देखने की अनुमति माँग रहा है',
          body: [
            'Roviq सपोर्ट से किसी ने आपके संस्थान को उसके एक उपयोगकर्ता के रूप में देखने की अनुमति माँगी है।',
            '',
            `यदि आप अनुमति देते हैं, तो उन्हें यह कोड दें: ${p.otp}`,
            'यह 5 मिनट में समाप्त हो जाएगा।',
            '',
            'यदि आपको इसकी अपेक्षा नहीं थी, तो इस ईमेल को अनदेखा करें, कुछ नहीं होगा।',
          ].join('\n'),
        }
      : {
          subject: 'Roviq support asks to view your institute',
          body: [
            'Someone from Roviq support has asked to view your institute as one of its users.',
            '',
            `If you approve, give them this code: ${p.otp}`,
            'It expires in 5 minutes.',
            '',
            'If you did not expect this, ignore this email and nothing will happen.',
          ].join('\n'),
        };
  },
};

export interface UserWelcomeParams {
  username: string;
  firstName: string | null;
  tempPassword: string;
  /** The sign-in page of the portal the account belongs to. */
  signInUrl: string;
  /** Set for an account an institute created: the person did not ask for it, so it is named. */
  institute: { name: Record<string, string> } | null;
}

function nameIn(name: Record<string, string>, locale: 'en' | 'hi'): string {
  return name[locale] ?? name.en ?? Object.values(name)[0] ?? '';
}

const YOUR_INSTITUTE: Record<Locale, string> = { en: 'Your institute', hi: 'आपके संस्थान' };

// A registered text may carry only an allow-listed fixed address, so the SMS names no URL.
export const userWelcomeInstituteSms: SmsTemplate<UserWelcomeParams> = {
  key: 'USER_WELCOME_INSTITUTE',
  body: {
    en: "Roviq: {{1}} created your account. Username: {{2}} | Temp password: {{3}}. Sign in on your institute's Roviq portal or the Roviq app and set your own password.",
    hi: 'Roviq: {{1}} ने आपका खाता बनाया। यूज़रनेम: {{2}}, अस्थायी पासवर्ड: {{3}}। संस्थान के Roviq पोर्टल पर साइन इन कर पासवर्ड बदलें।',
  },
  variables: (p, locale) => [
    cleanVariable(p.institute ? nameIn(p.institute.name, locale) : '', YOUR_INSTITUTE[locale]),
    p.username,
    p.tempPassword,
  ],
  exactPositions: [2, 3],
  maxSegments: { en: 2, hi: 3 },
};

export const userWelcomeSms: SmsTemplate<UserWelcomeParams> = {
  key: 'USER_WELCOME',
  body: {
    en: 'Roviq: Account ready. Username: {{1}} | Temp password: {{2}}. Change it on first login.',
    hi: 'Roviq: खाता तैयार है। यूज़रनेम: {{1}} | अस्थायी पासवर्ड: {{2}}। पहली बार लॉग इन करते समय इसे बदलें।',
  },
  variables: (p) => [p.username, p.tempPassword],
  exactPositions: [1, 2],
  maxSegments: { en: 2, hi: 3 },
};

/** Carries the temporary password, so it never becomes an in-app row. */
export const userWelcomeType: SecretNotificationType<UserWelcomeParams> = {
  key: 'USER_WELCOME',
  secret: true,
  channels: ['EMAIL', 'SMS'],
  outsideCopy: (p, channel, locale) => {
    const name = p.firstName ?? p.username;
    if (p.institute) {
      const institute = nameIn(p.institute.name, locale);
      const url = p.signInUrl;
      if (channel === 'SMS') {
        return { subject: '', body: smsText(userWelcomeInstituteSms, p, locale) };
      }
      return locale === 'hi'
        ? {
            subject: `${institute} के लिए आपके Roviq साइन-इन विवरण`,
            body: [
              `नमस्ते ${name},`,
              '',
              `${institute} ने Roviq पर आपके लिए एक खाता बनाया है।`,
              `यूज़रनेम: ${p.username}`,
              `अस्थायी पासवर्ड: ${p.tempPassword}`,
              '',
              `${url} पर साइन इन करें। पहली बार साइन इन करते समय आपसे अपना पासवर्ड बनाने को कहा जाएगा।`,
              `यदि आपको इसकी अपेक्षा नहीं थी, तो ${institute} से संपर्क करें।`,
            ].join('\n'),
          }
        : {
            subject: `Your Roviq sign-in details for ${institute}`,
            body: [
              `Hi ${name},`,
              '',
              `${institute} has created a Roviq account for you.`,
              `Username: ${p.username}`,
              `Temporary password: ${p.tempPassword}`,
              '',
              `Sign in at ${url}. You will be asked to choose your own password the first time.`,
              `If you did not expect this, contact ${institute}.`,
            ].join('\n'),
          };
    }
    if (channel === 'SMS') return { subject: '', body: smsText(userWelcomeSms, p, locale) };
    return locale === 'hi'
      ? {
          subject: 'Roviq में आपका स्वागत है — आपका खाता तैयार है',
          body: [
            `नमस्ते ${name},`,
            '',
            'आपका Roviq खाता बना दिया गया है।',
            `यूज़रनेम: ${p.username}`,
            `अस्थायी पासवर्ड: ${p.tempPassword}`,
            '',
            `${p.signInUrl} पर साइन इन करें। पहली बार साइन इन करते समय आपसे अपना पासवर्ड बनाने को कहा जाएगा।`,
          ].join('\n'),
        }
      : {
          subject: 'Welcome to Roviq — your account is ready',
          body: [
            `Hi ${name},`,
            '',
            'Your Roviq account has been set up.',
            `Username: ${p.username}`,
            `Temporary password: ${p.tempPassword}`,
            '',
            `Sign in at ${p.signInUrl}. You will be asked to choose your own password the first time.`,
          ].join('\n'),
        };
  },
};
