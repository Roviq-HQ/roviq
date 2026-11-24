import { defineFlow, step } from './flow';
import { type Locale, localized, type RegularNotificationType } from './notification-type';

export const BILLING_MESSAGE_KINDS = [
  'subscription-activated',
  'subscription-pending',
  'subscription-canceled',
  'subscription-paused',
  'subscription-resumed',
  'subscription-ended',
  'payment-received',
  'payment-failed',
] as const;

export type BillingMessageKind = (typeof BILLING_MESSAGE_KINDS)[number];

export interface BillingEventParams {
  kind: BillingMessageKind;
  subscriptionId: string;
  instituteId: string;
  planName: string;
  planAmount: number;
  planCurrency: string;
}

interface Copy {
  subject: string;
  body: string;
}

function copy(p: BillingEventParams, locale: Locale): Copy {
  const { planName, planAmount, planCurrency } = p;
  const hi = locale === 'hi';
  switch (p.kind) {
    case 'subscription-activated':
      return hi
        ? { subject: 'सदस्यता सक्रिय', body: `${planName} की आपकी सदस्यता अब सक्रिय है।` }
        : {
            subject: 'Subscription activated',
            body: `Your subscription to ${planName} is now active.`,
          };
    case 'subscription-pending':
      return hi
        ? {
            subject: 'सदस्यता भुगतान के लिए लंबित',
            body: `${planName} की सदस्यता बनाई गई है — इसे सक्रिय करने के लिए भुगतान पूरा करें।`,
          }
        : {
            subject: 'Subscription pending payment',
            body: `A subscription to ${planName} has been created — complete payment to activate.`,
          };
    case 'subscription-canceled':
      return hi
        ? { subject: 'सदस्यता रद्द', body: `आपकी ${planName} सदस्यता रद्द कर दी गई है।` }
        : {
            subject: 'Subscription canceled',
            body: `Your ${planName} subscription has been canceled.`,
          };
    case 'subscription-paused':
      return hi
        ? { subject: 'सदस्यता रोकी गई', body: `आपकी ${planName} सदस्यता रोक दी गई है।` }
        : {
            subject: 'Subscription paused',
            body: `Your ${planName} subscription has been paused.`,
          };
    case 'subscription-resumed':
      return hi
        ? { subject: 'सदस्यता फिर से शुरू', body: `आपकी ${planName} सदस्यता फिर से शुरू हो गई है।` }
        : {
            subject: 'Subscription resumed',
            body: `Your ${planName} subscription has been resumed.`,
          };
    case 'subscription-ended':
      return hi
        ? { subject: 'सदस्यता समाप्त', body: `आपकी ${planName} सदस्यता की अवधि समाप्त हो गई है।` }
        : {
            subject: 'Subscription ended',
            body: `Your ${planName} subscription period has ended.`,
          };
    case 'payment-received':
      return hi
        ? {
            subject: 'भुगतान प्राप्त हुआ',
            body: `${planName} के लिए ${planAmount} ${planCurrency} का भुगतान प्राप्त हुआ।`,
          }
        : {
            subject: 'Payment received',
            body: `Payment of ${planAmount} ${planCurrency} received for ${planName}.`,
          };
    case 'payment-failed':
      return hi
        ? {
            subject: 'भुगतान विफल',
            body: `${planName} का भुगतान विफल रहा — कृपया अपना भुगतान तरीका अपडेट करें।`,
          }
        : {
            subject: 'Payment failed',
            body: `Payment failed for ${planName} — please update your payment method.`,
          };
  }
}

export const billingEventType: RegularNotificationType<BillingEventParams> = {
  key: 'BILLING_EVENT',
  secret: false,
  settingsCategory: null,
  critical: true,
  flow: defineFlow({ steps: [step.parallel(['EMAIL', 'PUSH'])] }),
  digest: null,
  inAppCopy: (p) => ({
    title: localized((l) => copy(p, l).subject),
    body: localized((l) => copy(p, l).body),
    data: {
      subscriptionId: p.subscriptionId,
      instituteId: p.instituteId,
      kind: p.kind,
      path: `/admin/institutes/${p.instituteId}`,
    },
  }),
  outsideCopy: (p, _channel, locale) => copy(p, locale),
};
