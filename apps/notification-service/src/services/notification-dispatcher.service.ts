import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { TemporalClientService } from '@roviq/temporal';
import { ChannelSender, toPushData } from '../delivery/channel-sender';
import { type ChannelSettings, resolveChannelSettings } from '../delivery/channel-settings';
import { nextDigestRunOrDefault } from '../delivery/digest-schedule';
import { smsDraftForSecret } from '../delivery/sms/sms-templates';
import { NotificationConfigReadRepository } from '../repositories/notification-config-read.repository';
import { NotificationWriteRepository } from '../repositories/notification-write.repository';
import { RecipientReadRepository } from '../repositories/recipient-read.repository';
import type { Audience, Recipient } from '../repositories/types';
import { composeInApp, composeSecret } from '../types/compose';
import { appOnlyFlow, channelsOf } from '../types/flow';
import {
  REGULAR_TYPES,
  type RegularPayload,
  SECRET_TYPES,
  type SecretPayload,
} from '../types/registry';
import {
  DIGEST_ITEM_SIGNAL,
  DIGEST_WORKFLOW_TYPE,
  type DigestItem,
  type DigestWorkflowInput,
  digestWorkflowId,
  FLOW_WORKFLOW_TYPE,
  type FlowRecipient,
  type FlowWorkflowInput,
  flowWorkflowId,
  NOTIFICATION_TASK_QUEUE,
  type RecipientsRef,
} from '../workflows/notification-workflow.types';

interface DigestSchedule {
  tenantId: string;
  cron: string;
  defaultCron: string;
}

/** The in-app row of one recipient of an event. */
const recipientKey = (eventKey: string, userId: string) => `${eventKey}:${userId}`;

/** The JetStream message an event came in; its stream sequence makes the dedupe key. */
export interface EventSource {
  stream: string;
  sequence: number;
}

export interface RegularDispatch {
  message: RegularPayload;
  audience: Audience;
  /** In alert order; one flow walks them all. */
  recipients: Recipient[];
  /** Where the recipients came from, re-checked at each send; null for the one the event names. */
  recipientsRef: RecipientsRef;
  source: EventSource;
  /**
   * The event key, without any recipient: a business key for a type where a re-sent event must
   * not alert twice (one absence, one alert), or a distinct key for a second dispatch of the same
   * event. Without it the key is the event's stream sequence and type.
   */
  dedupeKey?: string;
  /** False when the event names no portal to show an in-app copy in. */
  inApp: boolean;
}

export interface SecretDispatch {
  message: SecretPayload;
  audience: Audience;
  recipientUserId: string;
  /** Addresses the event names, per channel; a channel not listed is looked up by user id. */
  addresses: Partial<Record<NotificationChannel, string | null>>;
}

export const SECRET_MAX_ATTEMPTS = 3;

/** Pause between secret send attempts; a class so tests can replace it. */
@Injectable()
export class RetryWait {
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
const SECRET_BACKOFF_MS = [1_000, 3_000];

/**
 * The one entry point every listener calls (ROV-314). Writes each recipient's in-app row, then
 * hands the outside channels to Temporal: one flow workflow per event (ROV-332), or a digest
 * workflow per recipient. Secret types never reach Temporal:
 * they are sent here, inside the listener call.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly configs: NotificationConfigReadRepository,
    private readonly recipients: RecipientReadRepository,
    private readonly writes: NotificationWriteRepository,
    private readonly sender: ChannelSender,
    private readonly temporal: TemporalClientService,
    private readonly eventBus: EventBusService,
    private readonly retryWait: RetryWait,
  ) {}

  async dispatch(req: RegularDispatch): Promise<void> {
    const { message, audience } = req;
    if (req.recipients.length === 0) return;
    const type = REGULAR_TYPES[message.type];
    const row =
      type.settingsCategory !== null && audience.tenantId !== null
        ? await this.configs.findByTenantAndType(audience.tenantId, type.settingsCategory)
        : null;
    const settings = resolveChannelSettings(
      {
        ignoresInstituteSettings: type.critical,
        defaultDigestCron: type.digest?.defaultCron ?? null,
      },
      row,
    );
    const eventKey = req.dedupeKey ?? `${req.source.stream}:${req.source.sequence}:${message.type}`;
    // A digest collects the outside channels per recipient; otherwise one flow walks them all.
    const plan: DigestSchedule | { flowId: string } =
      settings.digestCron !== null && type.digest !== null && audience.tenantId !== null
        ? {
            tenantId: audience.tenantId,
            cron: settings.digestCron,
            defaultCron: type.digest.defaultCron,
          }
        : { flowId: flowWorkflowId(eventKey) };
    const outside = channelsOf(type.flow).length > 0;
    // Only a row some workflow waits on carries its id: seen events for others signal nothing.
    const flowId = outside && 'flowId' in plan ? plan.flowId : null;
    const copy = composeInApp(message);

    const recipients: FlowRecipient[] = [];
    for (const recipient of req.recipients) {
      let notificationId: string | null = null;
      if (req.inApp && settings.inApp) {
        const stored = await this.writes.insertInApp({
          audience,
          recipient,
          type: message.type,
          title: { ...copy.title },
          body: { ...copy.body },
          data: copy.data,
          dedupeKey: recipientKey(eventKey, recipient.userId),
          flowId,
        });
        notificationId = stored.id;
        if (stored.created) {
          this.eventBus.emit(EVENT_PATTERNS.NOTIFICATION.INAPP_CREATED, {
            notificationId: stored.id,
            scope: audience.scope,
            tenantId: audience.tenantId,
            resellerId: audience.resellerId,
            recipientUserId: recipient.userId,
          });
        }
      }
      recipients.push({ userId: recipient.userId, notificationId });
    }

    if (!outside) return;

    if (!('flowId' in plan)) {
      for (const [index, recipient] of req.recipients.entries()) {
        const key = recipientKey(eventKey, recipient.userId);
        await this.signalDigest(req, recipient, index > 0, plan, key, settings);
      }
      return;
    }

    const input: FlowWorkflowInput = {
      flowId: plan.flowId,
      audience,
      message,
      recipients,
      recipientsRef: req.recipientsRef,
      flow: type.flow,
      enabled: settings.channels,
      critical: type.critical,
      data: toPushData(copy.data),
    };
    const started = await this.temporal.startWorkflowOnce(FLOW_WORKFLOW_TYPE, {
      workflowId: plan.flowId,
      taskQueue: NOTIFICATION_TASK_QUEUE,
      args: [input],
    });
    if (!started) this.logger.log(`Flow ${plan.flowId} already started; redelivered event`);
  }

  private async signalDigest(
    req: RegularDispatch,
    recipient: Recipient,
    appOnly: boolean,
    schedule: DigestSchedule,
    dedupeKey: string,
    settings: ChannelSettings,
  ): Promise<void> {
    const type = REGULAR_TYPES[req.message.type];
    // A guardian after the first is sent no paid channel or email (ROV-328); maybe nothing at all.
    if (appOnly && channelsOf(appOnlyFlow(type.flow)).length === 0) return;
    const { tenantId } = schedule;
    const timezone = (await this.recipients.findInstituteTimezone(tenantId)) ?? 'Asia/Kolkata';
    const { runAt, usedDefault } = nextDigestRunOrDefault(
      schedule.cron,
      schedule.defaultCron,
      timezone,
      new Date(),
    );
    if (usedDefault) {
      this.logger.warn(`Institute ${tenantId} has an invalid digest cron; using the default`);
    }
    const input: DigestWorkflowInput = {
      audience: req.audience,
      recipientUserId: recipient.userId,
      type: req.message.type,
      flow: type.flow,
      enabled: settings.channels,
      critical: type.critical,
      appOnly,
      runAt: runAt.toISOString(),
    };
    const item: DigestItem = { dedupeKey, message: req.message, runAt: runAt.toISOString() };
    await this.temporal.signalWithStart(DIGEST_WORKFLOW_TYPE, {
      workflowId: digestWorkflowId(tenantId, recipient.userId, req.message.type),
      taskQueue: NOTIFICATION_TASK_QUEUE,
      args: [input],
      signal: DIGEST_ITEM_SIGNAL,
      signalArgs: [item],
    });
  }

  /**
   * Sends a secret type on its channels right here: a code or password must not be stored in
   * Temporal history. Up to 3 attempts per channel; a provider failure does not throw (the
   * code would expire before a redelivery), a database failure does.
   */
  async dispatchSecret(req: SecretDispatch): Promise<void> {
    const { message } = req;
    const type = SECRET_TYPES[message.type];
    for (const channel of type.channels) {
      const given = req.addresses[channel];
      for (let attempt = 1; attempt <= SECRET_MAX_ATTEMPTS; attempt += 1) {
        const outcome = await this.sender.attempt({
          type: message.type,
          channel,
          audience: req.audience,
          recipientUserId: req.recipientUserId,
          notificationId: null,
          flowId: null,
          channelEnabled: true,
          critical: true,
          deferrable: false,
          attempt,
          address: given === undefined ? 'lookup' : { given },
          data: {},
          compose: (locale) => composeSecretMessage(message, channel, locale),
          sms: (locale) => smsDraftForSecret(message, locale),
        });
        if (outcome.status !== 'FAILED' || !outcome.retryable) break;
        this.logger.warn(
          `${message.type} ${channel} attempt ${attempt} for user ${req.recipientUserId} failed: ${outcome.errorCode}`,
        );
        const backoff = SECRET_BACKOFF_MS[attempt - 1];
        if (backoff !== undefined && attempt < SECRET_MAX_ATTEMPTS)
          await this.retryWait.wait(backoff);
      }
    }
  }
}

function composeSecretMessage(
  message: SecretPayload,
  channel: NotificationChannel,
  locale: 'en' | 'hi',
) {
  return composeSecret(message.type, message.params, channel, locale);
}
