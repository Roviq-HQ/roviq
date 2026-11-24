import { MessageTemplateCategory } from '@roviq/common-types';
import type { SmsTemplate } from '../delivery/sms/sms-template';
import { renderTemplate, type WhatsAppTemplate } from '../delivery/whatsapp/whatsapp-template';
import type { Locale, PlatformNotificationType } from './notification-type';

export interface DeliveryCanaryParams {
  /** ISO time the schedule asked for this check. */
  requestedAt: string;
}

/** "24 Nov 2026, 10:15 IST": the check's time, so a person reading the inbox can tell them apart. */
function checkTime(p: DeliveryCanaryParams, locale: Locale): string {
  const formatted = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(p.requestedAt));
  return `${formatted} IST`;
}

export const deliveryCanarySms: SmsTemplate<DeliveryCanaryParams> = {
  key: 'DELIVERY_CANARY',
  body: {
    en: 'Roviq: Delivery check of {{1}}. This message tests sending; no action is needed.',
    hi: 'Roviq: {{1}} की डिलीवरी जाँच। यह संदेश भेजने की जाँच है; कुछ करने की ज़रूरत नहीं।',
  },
  variables: (p, locale) => [checkTime(p, locale)],
  exactPositions: [],
  maxSegments: { en: 1, hi: 2 },
};

export const deliveryCanaryWhatsApp: WhatsAppTemplate<DeliveryCanaryParams> = {
  name: 'delivery_canary_v1',
  category: MessageTemplateCategory.UTILITY,
  body: {
    en: 'Roviq delivery check of {{1}}. This message tests sending; no action is needed.',
    hi: 'Roviq: {{1}} की डिलीवरी जाँच। यह संदेश भेजने की जाँच है; कुछ करने की ज़रूरत नहीं।',
  },
  variables: (p, locale) => [checkTime(p, locale)],
  buttonPath: () => 'login',
};

/**
 * The platform's scheduled test message (ROV-329): sent at once to the platform's own address,
 * never an in-app row, never about an institute.
 */
export const deliveryCanaryType: PlatformNotificationType<DeliveryCanaryParams> = {
  key: 'DELIVERY_CANARY',
  platform: true,
  outsideCopy: (p, channel, locale) => {
    if (channel === 'SMS') {
      return {
        subject: '',
        body: renderTemplate(deliveryCanarySms.body[locale], [checkTime(p, locale)]),
      };
    }
    if (channel === 'WHATSAPP') {
      return {
        subject: '',
        body: renderTemplate(deliveryCanaryWhatsApp.body[locale], [checkTime(p, locale)]),
      };
    }
    return locale === 'hi'
      ? {
          subject: `Roviq डिलीवरी जाँच ${checkTime(p, locale)}`,
          body: 'यह संदेश जाँचता है कि Roviq संदेश भेज पा रहा है। कुछ करने की ज़रूरत नहीं।',
        }
      : {
          subject: `Roviq delivery check ${checkTime(p, locale)}`,
          body: 'This message checks that Roviq can send messages. No action is needed.',
        };
  },
};
