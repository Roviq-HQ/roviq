import { ApplicationFailure } from '@temporalio/activity';
import { ChannelAdapterError } from '../delivery/adapters/channel-adapter';
import { TemplatePortalUrlError } from '../delivery/whatsapp/template-submission';
import { type TemplateSync, TemplateSyncPausedError } from '../delivery/whatsapp/template-sync';
import type { TemplateSyncInput, TemplateSyncOutcome } from './notification-workflow.types';

/**
 * The template sync as a Temporal activity. Errors keep a stable type so the workflow's retry
 * rules can tell "fix the configuration" from "try again later"; no message holds a token.
 */
export function createTemplateSyncActivities(sync: TemplateSync | null) {
  return {
    async syncWhatsAppTemplates(input: TemplateSyncInput): Promise<TemplateSyncOutcome> {
      if (sync === null) {
        throw ApplicationFailure.nonRetryable('The WhatsApp provider is not configured here');
      }
      try {
        const { pending } = await sync.sync(input.providerAccountId);
        return { pending };
      } catch (err) {
        if (err instanceof TemplatePortalUrlError) {
          throw ApplicationFailure.nonRetryable(err.message, 'TemplatePortalUrlError');
        }
        if (err instanceof TemplateSyncPausedError) {
          throw ApplicationFailure.create({
            message: err.message,
            type: 'TemplateSyncPaused',
            nextRetryDelay: Math.max(1_000, err.retryAt.getTime() - Date.now()),
          });
        }
        if (err instanceof ChannelAdapterError) {
          throw ApplicationFailure.create({
            message: `${err.code}: ${err.message}`,
            type: err.code,
            nonRetryable: err.code === 'WA_PERMISSION_MISSING',
            ...(err.retryAfterMs !== null ? { nextRetryDelay: err.retryAfterMs } : {}),
          });
        }
        throw err;
      }
    },
  };
}
