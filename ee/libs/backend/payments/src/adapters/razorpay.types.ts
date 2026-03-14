import type { Subscriptions } from 'razorpay/dist/types/subscriptions';

/**
 * Razorpay webhook event envelope.
 * @see https://razorpay.com/docs/webhooks/payloads/subscriptions/
 */
export interface RazorpayWebhookBody {
  entity: 'event';
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    subscription?: { entity: RazorpaySubscriptionEntity };
    payment?: { entity: RazorpayPaymentEntity };
  };
  created_at: number;
}

/** Subscription entity inside a webhook payload — same shape as the SDK type. */
export type RazorpaySubscriptionEntity = Subscriptions.RazorpaySubscription;

/** Payment entity inside a webhook payload (subset of fields we use). */
export interface RazorpayPaymentEntity {
  id: string;
  entity: 'payment';
  amount: number;
  currency: string;
  status: string;
  order_id: string | null;
  method: string;
  description: string | null;
  email: string;
  contact: string;
  notes: Record<string, string | number>;
  fee: number;
  tax: number;
  created_at: number;
}
