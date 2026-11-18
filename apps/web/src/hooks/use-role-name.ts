'use client';

import { useI18nField } from '@roviq/i18n';
import { useTranslations } from 'next-intl';

type RoleName = Record<string, string> | null | undefined;

/**
 * Display name of a role.
 *
 * System roles store their key as the name (`class_teacher`) because the server matches
 * on it, so those get a translated label. A role an institute named itself is shown as
 * written, in the current language.
 */
export function useRoleName(): (name: RoleName) => string {
  const t = useTranslations('roles');
  const resolveI18n = useI18nField();
  return (name) => {
    const key = name?.en;
    return key && t.has(key) ? t(key) : resolveI18n(name);
  };
}
