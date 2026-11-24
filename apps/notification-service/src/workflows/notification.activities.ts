import { ApplicationFailure, Context } from '@temporalio/activity';
import type { ChannelSender } from '../delivery/channel-sender';
import { smsDraftForRegular } from '../delivery/sms/sms-templates';
import {
  whatsappDigestTemplateFor,
  whatsappTemplateFor,
} from '../delivery/whatsapp/whatsapp-templates';
import type { NotificationWriteRepository } from '../repositories/notification-write.repository';
import type { RecipientReadRepository } from '../repositories/recipient-read.repository';
import { composeDigest, composeOutside } from '../types/compose';
import { REGULAR_TYPES } from '../types/registry';
import type {
  NotificationActivities,
  RecordSkipInput,
  SendChannelInput,
} from './notification-workflow.types';

export interface NotificationActivityDeps {
  sender: ChannelSender;
  recipients: RecipientReadRepository;
  writes: NotificationWriteRepository;
}

/**
 * `attempt` is Temporal's own attempt number, so each retry writes its own delivery row.
 * A provider failure becomes FAILED and then an ApplicationFailure carrying only the stable
 * error code, never the provider's text; one that would be refused again is not retried.
 */
export function createNotificationActivities(
  deps: NotificationActivityDeps,
  attemptOf: () => number = () => Context.current().info.attempt,
): Omit<NotificationActivities, 'requestCanary'> {
  const { sender, recipients, writes } = deps;

  async function recordSkip(input: RecordSkipInput): Promise<void> {
    await writes.recordDelivery({
      audience: input.audience,
      notificationId: input.notificationId,
      recipientUserId: input.recipientUserId,
      type: input.type,
      channel: input.channel,
      attempt: 1,
      outcome: { status: 'SKIPPED', provider: null, skipReason: input.reason },
      flowId: input.flowId,
    });
  }

  /** A guardian unlinked or deactivated after the flow started is not sent to. */
  async function stillRecipient(input: SendChannelInput): Promise<boolean> {
    const ref = input.recipientsRef;
    if (ref === null) return true;
    const tenantId = input.audience.tenantId;
    if (tenantId === null) return false;
    return recipients.isActiveGuardianOf(tenantId, ref.studentMembershipId, input.recipientUserId);
  }

  return {
    async sendChannel(input: SendChannelInput) {
      const { content } = input;
      const type = content.kind === 'single' ? content.message.type : content.digest.type;
      const notificationId = content.kind === 'single' ? content.notificationId : null;
      if (!(await stillRecipient(input))) {
        await recordSkip({
          audience: input.audience,
          recipientUserId: input.recipientUserId,
          notificationId,
          type,
          channel: input.channel,
          reason: 'recipient_removed',
          flowId: input.flowId,
        });
        return 'SKIPPED';
      }
      const outcome = await sender.attempt({
        type,
        channel: input.channel,
        audience: input.audience,
        recipientUserId: input.recipientUserId,
        notificationId,
        flowId: input.flowId,
        channelEnabled: input.enabled,
        critical: REGULAR_TYPES[type].critical,
        digest: content.kind === 'digest',
        deferrable: input.deferrable,
        attempt: attemptOf(),
        address: 'lookup',
        data: input.data,
        compose: (locale) =>
          content.kind === 'single'
            ? composeOutside(content.message, input.channel, locale)
            : composeDigest(content.digest, input.channel, locale),
        template: (locale) =>
          content.kind === 'single'
            ? whatsappTemplateFor(content.message, locale)
            : whatsappDigestTemplateFor(content.digest, locale),
        sms: (locale) =>
          content.kind === 'single' ? smsDraftForRegular(content.message, locale) : null,
      });
      if (outcome.status === 'DEFERRED') {
        return { deferUntil: outcome.until.toISOString(), reason: outcome.reason };
      }
      if (outcome.status === 'FAILED') {
        const message = `channel ${input.channel} failed`;
        throw outcome.retryable
          ? ApplicationFailure.retryable(message, outcome.errorCode)
          : ApplicationFailure.nonRetryable(message, outcome.errorCode);
      }
      return outcome.status;
    },
    recordSkip,
  };
}
