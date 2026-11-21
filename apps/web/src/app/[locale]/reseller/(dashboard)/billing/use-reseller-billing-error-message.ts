import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useTranslations } from 'next-intl';

/**
 * Maps a reseller billing failure to translated copy via its `extensions.code`.
 * `fallback` is action-specific copy for codes without a message; `generic` otherwise.
 */
export function useResellerBillingErrorMessage() {
  const t = useTranslations('billing.errors');
  return (err: unknown, fallback?: string): string => {
    const code = extractGraphQLErrorCode(err);
    if (code && t.has(code)) return t(code);
    return fallback ?? t('generic');
  };
}
