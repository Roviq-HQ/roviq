import type { RegularMessage } from '../../types/compose';
import { type DeliveryCanaryParams, deliveryCanarySms } from '../../types/delivery-canary.type';
import type { Locale } from '../../types/notification-type';
import type {
  RegularTypeKey,
  SecretParamsMap,
  SecretPayload,
  SecretTypeKey,
} from '../../types/registry';
import {
  impersonationOtpSms,
  userWelcomeInstituteSms,
  userWelcomeSms,
} from '../../types/secret.types';
import { type SmsDraft, type SmsTemplate, toSmsDraft } from './sms-template';

type SecretSmsTemplate = {
  [K in SecretTypeKey]: SmsTemplate<SecretParamsMap[K]>;
}[SecretTypeKey];

/** Every registered template, for the tests and for the operator's registration list. */
export const SMS_TEMPLATES: readonly (SecretSmsTemplate | SmsTemplate<DeliveryCanaryParams>)[] = [
  impersonationOtpSms,
  userWelcomeInstituteSms,
  userWelcomeSms,
  deliveryCanarySms,
];

export function smsDraftForCanary(params: DeliveryCanaryParams, locale: Locale): SmsDraft {
  return toSmsDraft(deliveryCanarySms, params, locale);
}

/**
 * null when the message has no registered SMS template. Throws `SmsVariableError` when an
 * exact value does not fit.
 */
export function smsDraftForSecret(message: SecretPayload, locale: Locale): SmsDraft | null {
  switch (message.type) {
    case 'IMPERSONATION_OTP':
      return toSmsDraft(impersonationOtpSms, message.params, locale);
    case 'USER_WELCOME':
      return toSmsDraft(
        message.params.institute ? userWelcomeInstituteSms : userWelcomeSms,
        message.params,
        locale,
      );
    case 'EMAIL_VERIFICATION':
      return null;
  }
}

/** No regular type sends SMS yet; one call for the delivery activity either way. */
export function smsDraftForRegular<K extends RegularTypeKey>(
  _message: RegularMessage<K>,
  _locale: Locale,
): SmsDraft | null {
  return null;
}
