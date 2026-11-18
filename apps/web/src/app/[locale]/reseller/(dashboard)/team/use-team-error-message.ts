import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useTranslations } from 'next-intl';

/** Maps a team mutation failure to translated copy via its `extensions.code`. */
export function useTeamErrorMessage() {
  const t = useTranslations('resellerTeam.errors');
  return (err: unknown): string => {
    const code = extractGraphQLErrorCode(err);
    return code && t.has(code) ? t(code) : t('generic');
  };
}
