import type { SecretNotificationType } from './notification-type';

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

/** SMS and email only: an impersonated session could read the target's in-app inbox. */
export const impersonationOtpType: SecretNotificationType<ImpersonationOtpParams> = {
  key: 'IMPERSONATION_OTP',
  secret: true,
  channels: ['SMS', 'EMAIL'],
  // The requester may be reseller staff, not an admin, and the code is read out to them:
  // the recipient enters it nowhere.
  outsideCopy: (p, channel, locale) => {
    if (channel === 'SMS') {
      return {
        subject: '',
        body:
          locale === 'hi'
            ? `Roviq: Roviq सपोर्ट से किसी ने आपके संस्थान को उसके एक उपयोगकर्ता के रूप में देखने की अनुमति माँगी है। यदि आप अनुमति देते हैं, तो उन्हें यह कोड दें: ${p.otp}। यह 5 मिनट में समाप्त हो जाएगा। यदि आपको इसकी अपेक्षा नहीं थी, तो इस संदेश को अनदेखा करें, कुछ नहीं होगा।`
            : `Roviq: Someone from Roviq support has asked to view your institute as one of its users. If you approve, give them this code: ${p.otp}. It expires in 5 minutes. If you did not expect this, ignore this message and nothing will happen.`,
      };
    }
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
}

/** Carries the temporary password, so it never becomes an in-app row. */
export const userWelcomeType: SecretNotificationType<UserWelcomeParams> = {
  key: 'USER_WELCOME',
  secret: true,
  channels: ['EMAIL', 'SMS'],
  outsideCopy: (p, channel, locale) => {
    const name = p.firstName ?? p.username;
    if (channel === 'SMS') {
      return {
        subject: '',
        body:
          locale === 'hi'
            ? `Roviq: खाता तैयार है। यूज़रनेम: ${p.username} | अस्थायी पासवर्ड: ${p.tempPassword}। पहली बार लॉग इन करते समय इसे बदलें।`
            : `Roviq: Account ready. Username: ${p.username} | Temp password: ${p.tempPassword}. Change it on first login.`,
      };
    }
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
            'लॉग इन करें और पहली बार साइन-इन करते समय अपना पासवर्ड बदलें।',
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
            'Log in and change your password on first sign-in.',
          ].join('\n'),
        };
  },
};
