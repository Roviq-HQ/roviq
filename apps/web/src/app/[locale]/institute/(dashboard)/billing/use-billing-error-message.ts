import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useTranslations } from 'next-intl';
import { CheckoutUnavailableError } from './gateway-checkout';

/** Maps an institute billing failure to translated copy via its `extensions.code`. */
export function useBillingErrorMessage() {
  const t = useTranslations('instituteBilling.errors');
  return (err: unknown, fallback: 'generic' | 'pdfFailed' = 'generic'): string => {
    if (err instanceof CheckoutUnavailableError) return t('checkoutUnavailable');
    const code = extractGraphQLErrorCode(err);
    return code && t.has(code) ? t(code) : t(fallback);
  };
}
