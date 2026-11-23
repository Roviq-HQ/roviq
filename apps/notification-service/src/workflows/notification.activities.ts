import { ApplicationFailure, Context } from '@temporalio/activity';
import type { ChannelSender } from '../delivery/channel-sender';
import { smsDraftForRegular } from '../delivery/sms/sms-templates';
import {
  whatsappDigestTemplateFor,
  whatsappTemplateFor,
} from '../delivery/whatsapp/whatsapp-templates';
import { composeDigest, composeOutside } from '../types/compose';
import { REGULAR_TYPES } from '../types/registry';
import type { NotificationActivities, SendChannelInput } from './notification-workflow.types';

/**
 * `attempt` is Temporal's own attempt number, so each retry writes its own delivery row.
 * A provider failure becomes FAILED and then an ApplicationFailure carrying only the stable
 * error code, never the provider's text; one that would be refused again is not retried.
 */
export function createNotificationActivities(
  sender: ChannelSender,
  attemptOf: () => number = () => Context.current().info.attempt,
): NotificationActivities {
  return {
    async sendChannel(input: SendChannelInput) {
      const { content } = input;
      const type = content.kind === 'single' ? content.message.type : content.digest.type;
      const outcome = await sender.attempt({
        type,
        channel: input.channel,
        audience: input.audience,
        recipientUserId: input.recipientUserId,
        notificationId: content.kind === 'single' ? content.notificationId : null,
        channelEnabled: input.enabled,
        critical: REGULAR_TYPES[type].critical,
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
      if (outcome.status === 'DEFERRED') return { deferUntil: outcome.until.toISOString() };
      if (outcome.status === 'FAILED') {
        const message = `channel ${input.channel} failed`;
        throw outcome.retryable
          ? ApplicationFailure.retryable(message, outcome.errorCode)
          : ApplicationFailure.nonRetryable(message, outcome.errorCode);
      }
      return outcome.status;
    },
  };
}
