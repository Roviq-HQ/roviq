import { workflow } from '@novu/framework';

const payloadSchema = {
  type: 'object',
  properties: {
    studentName: { type: 'string' },
    feeId: { type: 'string' },
    amount: { type: 'number' },
    currency: { type: 'string', default: 'INR' },
    dueDate: { type: 'string' },
    feeType: { type: 'string' },
    feePeriod: { type: 'string' },
    digestCron: { type: 'string' },
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
  required: ['studentName', 'feeId', 'amount', 'dueDate', 'feeType', 'feePeriod', 'config'],
  additionalProperties: false,
} as const;

export const feeReminderWorkflow = workflow(
  'fee-reminder',
  async ({ step, payload }) => {
    const summary = `${payload.studentName} has an upcoming ${payload.feeType} fee of ${payload.currency} ${payload.amount} for ${payload.feePeriod}, due ${payload.dueDate}.`;

    await step.inApp('fee-reminder-in-app', async () => ({
      subject: 'Fee Reminder',
      body: summary,
    }));

    await step.email(
      'fee-reminder-email',
      async () => ({
        subject: 'Fee Reminder',
        body: summary,
      }),
      { skip: () => !payload.config.email },
    );

    await step.chat('fee-reminder-whatsapp', async () => ({ body: summary }), {
      skip: () => !payload.config.whatsapp,
    });

    await step.push(
      'fee-reminder-push',
      async () => ({
        subject: 'Fee Reminder',
        body: summary,
      }),
      { skip: () => !payload.config.push },
    );
  },
  {
    payloadSchema,
    name: 'Fee Reminder',
    tags: ['fees'],
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
