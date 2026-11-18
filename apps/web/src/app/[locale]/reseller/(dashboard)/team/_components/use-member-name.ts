import { useI18nField } from '@roviq/i18n';

interface Named {
  username: string;
  profile?: {
    firstName?: Record<string, string> | null;
    lastName?: Record<string, string> | null;
  } | null;
}

/** Full name in the current language; the Roviq ID for someone who has no profile yet. */
export function useMemberName(): (member: Named) => string {
  const resolveI18n = useI18nField();
  return (member) => {
    const name = [resolveI18n(member.profile?.firstName), resolveI18n(member.profile?.lastName)]
      .filter(Boolean)
      .join(' ');
    return name || member.username;
  };
}
