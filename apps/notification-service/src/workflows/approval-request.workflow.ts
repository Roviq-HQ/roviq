import { workflow } from '@novu/framework';

/**
 * Approval-request workflow.
 *
 * Time-sensitive — no digest. All channels fire immediately.
 * WhatsApp, email, and push are conditional on the per-notification
 * channel config.
 */

const payloadSchema = {
  type: 'object',
  properties: {
    approvalType: { type: 'string' },
    requesterName: { type: 'string' },
    summary: { type: 'string' },
    actionUrl: { type: 'string' },
    config: {
      type: 'object',
      properties: {
        inApp: { type: 'boolean', default: true },
        whatsapp: { type: 'boolean', default: false },
        email: { type: 'boolean', default: false },
        push: { type: 'boolean', default: false },
      },
      required: ['inApp', 'whatsapp', 'email', 'push'],
      additionalProperties: false,
    },
  },
  required: ['approvalType', 'requesterName', 'summary', 'actionUrl', 'config'],
  additionalProperties: false,
} as const;

export const approvalRequestWorkflow = workflow(
  'approval-request',
  async ({ step, payload }) => {
    // Immediate in-app notification
    await step.inApp('approval-request-in-app', async () => ({
      subject: `Approval Needed: ${payload.approvalType}`,
      body: `${payload.requesterName} submitted a ${payload.approvalType} request: ${payload.summary}`,
      primaryAction: {
        label: 'Review',
        redirect: { url: payload.actionUrl },
      },
    }));

    // WhatsApp — skip if disabled
    await step.chat(
      'approval-request-whatsapp',
      async () => ({
        body: `Approval needed: ${payload.requesterName} submitted a ${payload.approvalType} request. ${payload.summary}`,
      }),
      {
        skip: () => !payload.config.whatsapp,
      },
    );

    // Email — skip if disabled
    await step.email(
      'approval-request-email',
      async () => ({
        subject: `Approval Needed: ${payload.approvalType}`,
        body: `${payload.requesterName} submitted a ${payload.approvalType} request: ${payload.summary}. <a href="${payload.actionUrl}">Review now</a>`,
      }),
      {
        skip: () => !payload.config.email,
      },
    );

    // Push — skip if disabled
    await step.push(
      'approval-request-push',
      async () => ({
        subject: `Approval Needed: ${payload.approvalType}`,
        body: `${payload.requesterName} — ${payload.summary}`,
      }),
      {
        skip: () => !payload.config.push,
      },
    );
  },
  {
    payloadSchema,
    name: 'Approval Request',
    tags: ['approvals'],
    preferences: {
      channels: {
        inApp: { enabled: true },
        email: { enabled: true },
        chat: { enabled: true },
        push: { enabled: true },
      },
    },
  },
);
