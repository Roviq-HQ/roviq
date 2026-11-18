import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useTranslations } from 'next-intl';

/** Maps a reseller mutation failure to translated copy via its `extensions.code`. */
export function useResellerErrorMessage() {
  const t = useTranslations('adminResellers.errors');
  return (err: unknown): string => {
    const code = extractGraphQLErrorCode(err);
    return code && t.has(code) ? t(code) : t('generic');
  };
}
