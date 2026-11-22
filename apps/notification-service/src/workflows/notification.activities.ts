import { ApplicationFailure, Context } from '@temporalio/activity';
import type { ChannelSender } from '../delivery/channel-sender';
import { composeDigest, composeOutside } from '../types/compose';
import type { NotificationActivities, SendChannelInput } from './notification-workflow.types';

/**
 * `attempt` is Temporal's own attempt number, so each retry writes its own delivery row.
 * A provider failure becomes FAILED and then an ApplicationFailure carrying only the stable
 * error code, never the provider's text.
 */
export function createNotificationActivities(
  sender: ChannelSender,
  attemptOf: () => number = () => Context.current().info.attempt,
): NotificationActivities {
  return {
    async sendChannel(input: SendChannelInput) {
      const { content } = input;
      const outcome = await sender.attempt({
        type: content.kind === 'single' ? content.message.type : content.digest.type,
        channel: input.channel,
        audience: input.audience,
        recipientUserId: input.recipientUserId,
        notificationId: content.kind === 'single' ? content.notificationId : null,
        channelEnabled: input.enabled,
        attempt: attemptOf(),
        address: 'lookup',
        data: input.data,
        compose: (locale) =>
          content.kind === 'single'
            ? composeOutside(content.message, input.channel, locale)
            : composeDigest(content.digest, input.channel, locale),
      });
      if (outcome.status === 'FAILED') {
        throw ApplicationFailure.retryable(`channel ${input.channel} failed`, outcome.errorCode);
      }
      return outcome.status;
    },
  };
}
