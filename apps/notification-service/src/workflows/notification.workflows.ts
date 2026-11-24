/**
 * Notification workflows, task queue `notifications`.
 *
 * NotificationFlowWorkflow (ROV-332): one per event; walks the type's flow over the event's
 * recipients and ends as soon as one of them is reached.
 * NotificationDigestWorkflow: one per institute + recipient + type; collects signalled items
 * until the window closes and sends one summary through the same flow.
 *
 * DeliveryCanaryWorkflow (ROV-329): started by the canary schedule; asks for one test message
 * per configured channel.
 *
 * None ever receives an address, a name, a code or a password.
 */
import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import type { FlowCondition } from '../types/flow';
import { appOnlyFlow } from '../types/flow-channels';
import { runCanary } from './canary-logic';
import { DigestBuffer, runDigestLoop } from './digest-logic';
import { runFlow, type SendResult } from './flow-runner';
import {
  type CanaryWorkflowInput,
  CHANNEL_ACTIVITY_RETRY,
  DIGEST_ITEM_SIGNAL,
  type DigestItem,
  type DigestWorkflowInput,
  FLOW_ARRIVAL_SIGNAL,
  type FlowArrival,
  type FlowRecipient,
  type FlowWorkflowInput,
  MAX_CHANNEL_DEFERRALS,
  type NotificationActivities,
  type SendChannelInput,
  sendData,
} from './notification-workflow.types';

const activities = proxyActivities<NotificationActivities>({
  startToCloseTimeout: '1 minute',
  retry: CHANNEL_ACTIVITY_RETRY,
});

const canaryActivities = proxyActivities<Pick<NotificationActivities, 'requestCanary'>>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3, initialInterval: '5 seconds' },
});

export const digestItemSignal = defineSignal<[DigestItem]>(DIGEST_ITEM_SIGNAL);
export const flowArrivalSignal = defineSignal<[FlowArrival]>(FLOW_ARRIVAL_SIGNAL);

type ChannelSend = Omit<SendChannelInput, 'deferrable'>;

/** Arrival of any of the given recipients; a signal about anyone else is ignored. */
class Arrivals {
  private reached = false;
  private readonly ids: ReadonlySet<string>;

  constructor(userIds: readonly string[]) {
    this.ids = new Set(userIds);
    setHandler(flowArrivalSignal, (arrival) => {
      if (this.ids.has(arrival.recipientUserId)) this.reached = true;
    });
  }

  arrived(): boolean {
    return this.reached;
  }

  reset(): void {
    this.reached = false;
  }

  /** True when arrival came within `ms`. */
  wait(ms: number): Promise<boolean> {
    return condition(() => this.reached, ms);
  }
}

/**
 * Sends on one channel, sleeping through each deferral (quiet hours, a full sender). Someone
 * reached during a deferral makes the send unneeded. A send that fails for good is FAILED.
 */
async function sendChannel(input: ChannelSend, arrivals: Arrivals): Promise<SendResult> {
  try {
    for (let deferrals = 0; deferrals <= MAX_CHANNEL_DEFERRALS; deferrals += 1) {
      const result = await activities.sendChannel({
        ...input,
        deferrable: deferrals < MAX_CHANNEL_DEFERRALS,
      });
      if (typeof result === 'string') return result;
      if (deferrals === MAX_CHANNEL_DEFERRALS) break;
      const wait = Date.parse(result.deferUntil) - Date.now();
      if (wait > 0 && (await arrivals.wait(wait))) {
        await activities.recordSkip({
          audience: input.audience,
          recipientUserId: input.recipientUserId,
          notificationId: input.content.kind === 'single' ? input.content.notificationId : null,
          type:
            input.content.kind === 'single'
              ? input.content.message.type
              : input.content.digest.type,
          channel: input.channel,
          reason: 'not_needed',
          flowId: input.flowId,
        });
        return 'SKIPPED';
      }
    }
    // The last call is not deferrable, so it answers with a final outcome before this.
    return 'SKIPPED';
  } catch {
    return 'FAILED';
  }
}

function conditionsOf(input: {
  critical: boolean;
  audience: FlowWorkflowInput['audience'];
}): Record<FlowCondition, boolean> {
  return {
    type_is_critical: input.critical,
    audience_is_institute: input.audience.scope === 'institute',
  };
}

export async function NotificationFlowWorkflow(input: FlowWorkflowInput): Promise<void> {
  const arrivals = new Arrivals(input.recipients.map((r) => r.userId));
  const type = input.message.type;

  await runFlow<FlowRecipient>(
    { flow: input.flow, recipients: input.recipients, conditions: conditionsOf(input) },
    {
      send: (recipient, channel) =>
        sendChannel(
          {
            audience: input.audience,
            recipientUserId: recipient.userId,
            channel,
            enabled: input.enabled[channel],
            content: {
              kind: 'single',
              message: input.message,
              notificationId: recipient.notificationId,
            },
            data: sendData(input.data, channel, recipient.notificationId),
            flowId: input.flowId,
            recipientsRef: input.recipientsRef,
          },
          arrivals,
        ),
      waitForArrival: (ms) => arrivals.wait(ms),
      arrived: () => arrivals.arrived(),
      sleep: (ms) => sleep(ms),
      recordSkip: (recipient, channel, reason) =>
        activities.recordSkip({
          audience: input.audience,
          recipientUserId: recipient.userId,
          notificationId: recipient.notificationId,
          type,
          channel,
          reason,
          flowId: input.flowId,
        }),
    },
  );
}

export async function NotificationDigestWorkflow(input: DigestWorkflowInput): Promise<void> {
  const buffer = new DigestBuffer<DigestItem['message']>();
  setHandler(digestItemSignal, (item) =>
    buffer.add({ dedupeKey: item.dedupeKey, runAt: item.runAt, value: item.message }),
  );
  // Reports of a summary's delivery find this workflow by its id, stored as the flow id.
  const flowId = workflowInfo().workflowId;
  const arrivals = new Arrivals([input.recipientUserId]);
  const flow = input.appOnly ? appOnlyFlow(input.flow) : input.flow;
  const recipient: FlowRecipient = { userId: input.recipientUserId, notificationId: null };

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
      arrivals.reset();
      await runFlow<FlowRecipient>(
        { flow, recipients: [recipient], conditions: conditionsOf(input) },
        {
          send: (_recipient, channel) =>
            sendChannel(
              {
                audience: input.audience,
                recipientUserId: input.recipientUserId,
                channel,
                enabled: input.enabled[channel],
                content: { kind: 'digest', digest },
                data: {},
                flowId,
                recipientsRef: null,
              },
              arrivals,
            ),
          waitForArrival: (ms) => arrivals.wait(ms),
          arrived: () => arrivals.arrived(),
          sleep: (ms) => sleep(ms),
          recordSkip: (_recipient, channel, reason) =>
            activities.recordSkip({
              audience: input.audience,
              recipientUserId: input.recipientUserId,
              notificationId: null,
              type: input.type,
              channel,
              reason,
              flowId,
            }),
        },
      );
    },
  });
}

export async function DeliveryCanaryWorkflow(input: CanaryWorkflowInput): Promise<void> {
  await runCanary(input, new Date().toISOString(), canaryActivities.requestCanary);
}
