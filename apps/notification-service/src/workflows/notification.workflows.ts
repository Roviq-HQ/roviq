/**
 * Notification workflows (ROV-314), task queue `notifications`.
 *
 * NotificationDeliveryWorkflow: one event, one recipient, one activity per outside channel.
 * NotificationDigestWorkflow: one per institute + recipient + type; collects signalled items
 * until the window closes and sends one summary per channel.
 *
 * Neither ever receives an address, a code or a password.
 */
import { defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import { DigestBuffer, runDigestLoop } from './digest-logic';
import {
  CHANNEL_ACTIVITY_RETRY,
  type DeliveryWorkflowInput,
  DIGEST_ITEM_SIGNAL,
  type DigestItem,
  type DigestWorkflowInput,
  MAX_CHANNEL_DEFERRALS,
  type NotificationActivities,
  type SendChannelInput,
} from './notification-workflow.types';

const activities = proxyActivities<NotificationActivities>({
  startToCloseTimeout: '1 minute',
  retry: CHANNEL_ACTIVITY_RETRY,
});

export const digestItemSignal = defineSignal<[DigestItem]>(DIGEST_ITEM_SIGNAL);

type ChannelSend = Omit<SendChannelInput, 'deferrable'>;

/** Sends on one channel, sleeping through each deferral (quiet hours, a full sender). */
async function sendChannel(input: ChannelSend): Promise<void> {
  for (let deferrals = 0; deferrals <= MAX_CHANNEL_DEFERRALS; deferrals += 1) {
    const result = await activities.sendChannel({
      ...input,
      deferrable: deferrals < MAX_CHANNEL_DEFERRALS,
    });
    // The last call is not deferrable, so it answers with a final outcome.
    if (typeof result === 'string' || deferrals === MAX_CHANNEL_DEFERRALS) return;
    const wait = Date.parse(result.deferUntil) - Date.now();
    if (wait > 0) await sleep(wait);
  }
}

/**
 * Push and email go first, then WhatsApp, then SMS. One channel failing (after its retries)
 * or waiting must not stop the others.
 */
async function sendInOrder(inputs: ChannelSend[]): Promise<void> {
  const later = (i: ChannelSend) => i.channel === 'WHATSAPP' || i.channel === 'SMS';
  await Promise.allSettled(inputs.filter((i) => !later(i)).map(sendChannel));
  for (const channel of ['WHATSAPP', 'SMS'] as const) {
    await Promise.allSettled(inputs.filter((i) => i.channel === channel).map(sendChannel));
  }
}

export async function NotificationDeliveryWorkflow(input: DeliveryWorkflowInput): Promise<void> {
  await sendInOrder(
    input.channels.map((plan) => ({
      audience: input.audience,
      recipientUserId: input.recipientUserId,
      channel: plan.channel,
      enabled: plan.enabled,
      content: { kind: 'single', message: input.message, notificationId: input.notificationId },
      data: input.data,
    })),
  );
}

export async function NotificationDigestWorkflow(input: DigestWorkflowInput): Promise<void> {
  const buffer = new DigestBuffer<DigestItem['message']>();
  setHandler(digestItemSignal, (item) =>
    buffer.add({ dedupeKey: item.dedupeKey, runAt: item.runAt, value: item.message }),
  );

  // No item is lost when the loop returns: a signal arriving meanwhile makes the server refuse the
  // completion and retry the task with signals applied first; a closed run is restarted by signalWithStart.
  await runDigestLoop({
    firstRunAt: Date.parse(input.runAt),
    buffer,
    sleepUntil: async (epochMs) => {
      const wait = epochMs - Date.now();
      if (wait > 0) await sleep(wait);
    },
    send: async (messages) => {
      const digest = { type: input.type, items: messages.map((m) => m.params) };
      await sendInOrder(
        input.channels.map((plan) => ({
          audience: input.audience,
          recipientUserId: input.recipientUserId,
          channel: plan.channel,
          enabled: plan.enabled,
          content: { kind: 'digest', digest },
          data: {},
        })),
      );
    },
  });
}
