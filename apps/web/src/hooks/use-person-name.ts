import { useI18nField } from '@roviq/i18n';

type I18nName = Record<string, string> | null | undefined;

/** Full name in the current language from i18n first and last names; '' when there is none. */
export function usePersonName(): (firstName: I18nName, lastName?: I18nName) => string {
  const resolveI18n = useI18nField();
  return (firstName, lastName) =>
    [resolveI18n(firstName), resolveI18n(lastName)].filter(Boolean).join(' ');
}
