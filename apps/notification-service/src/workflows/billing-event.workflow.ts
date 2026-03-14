import { workflow } from '@novu/framework';

const payloadSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
    eventType: {
      type: 'string',
      enum: [
        'subscription-activated',
        'subscription-pending',
        'subscription-canceled',
        'subscription-paused',
        'subscription-resumed',
        'subscription-completed',
        'payment-received',
        'payment-failed',
      ],
    },
  },
  required: ['subject', 'body', 'eventType'],
  additionalProperties: false,
} as const;

export const billingEventWorkflow = workflow(
  'billing-event',
  async ({ step, payload }) => {
    await step.inApp('billing-in-app', async () => ({
      subject: payload.subject,
      body: payload.body,
    }));

    await step.email('billing-email', async () => ({
      subject: payload.subject,
      body: payload.body,
    }));

    await step.push('billing-push', async () => ({
      subject: payload.subject,
      body: payload.body,
    }));
  },
  {
    payloadSchema,
    name: 'Billing Event',
    tags: ['system', 'billing'],
    preferences: {
      all: { readOnly: true },
      channels: {
        inApp: { enabled: true },
        email: { enabled: true },
        push: { enabled: true },
      },
    },
  },
);
