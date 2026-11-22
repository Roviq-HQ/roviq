import { workflow } from '@novu/framework';

/**
 * Email verification — critical (no opt-out), email only.
 *
 * The code proves that the account owner reads the mailbox, so it must reach nothing else:
 * no SMS, no WhatsApp, no push and no in-app message.
 */

const payloadSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
  },
  required: ['code'],
  additionalProperties: false,
} as const;

export const emailVerificationWorkflow = workflow(
  'email-verification',
  async ({ step, payload }) => {
    await step.email('email-verification-email', async () => ({
      subject: 'Your Roviq email verification code',
      body: [
        `Your verification code is ${payload.code}.`,
        '',
        'It is valid for 10 minutes. Enter it on your Account page in Roviq.',
        'If you did not ask for this code, you can ignore this email.',
      ].join('\n'),
    }));
  },
  {
    payloadSchema,
    name: 'Email Verification',
    tags: ['system', 'security'],
    preferences: {
      all: { readOnly: true },
      channels: {
        email: { enabled: true },
        sms: { enabled: false },
        inApp: { enabled: false },
        chat: { enabled: false },
        push: { enabled: false },
      },
    },
  },
);
