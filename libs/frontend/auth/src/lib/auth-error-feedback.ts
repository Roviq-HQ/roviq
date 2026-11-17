import { toast } from 'sonner';
import {
  type AuthErrorLabels,
  classifyClientError,
  DEFAULT_AUTH_ERROR_LABELS,
  resolveAuthErrorMessage,
} from './error-utils';

interface PresentAuthErrorOptions {
  labels?: AuthErrorLabels;
  /** Blocking errors the user must read and act on — rendered next to the form. */
  onInline: (message: string) => void;
  /** Offered as a toast action when the request never reached the server. */
  onRetry?: () => void;
}

/**
 * Transient failures (offline, dismissed passkey prompt, unsupported browser)
 * become toasts; everything else stays inline beside the form.
 */
export function presentAuthError(
  error: unknown,
  { labels, onInline, onRetry }: PresentAuthErrorOptions,
): void {
  const message = resolveAuthErrorMessage(error, labels);
  switch (classifyClientError(error)) {
    case 'passkeyCancelled':
      toast.info(message);
      return;
    case 'passkeyNotSupported':
      toast.error(message);
      return;
    case 'network':
      toast.error(message, {
        action: onRetry
          ? { label: labels?.retry ?? DEFAULT_AUTH_ERROR_LABELS.retry, onClick: onRetry }
          : undefined,
      });
      return;
    default:
      onInline(message);
  }
}
