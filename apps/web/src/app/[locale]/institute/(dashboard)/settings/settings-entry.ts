import type { AppAbility } from '@roviq/common-types';

/** Settings pages in sidebar order, with the ability each page's data needs. */
const SETTINGS_PAGES = [
  { href: '/settings/institute', action: 'read', subject: 'Institute' },
  { href: '/settings/consent', action: 'read', subject: 'Consent' },
  { href: '/settings/roles', action: 'read', subject: 'Role' },
] as const;

/** Every signed-in user may manage their own sessions, so it is the last resort. */
const ALWAYS_AVAILABLE = '/settings/sessions';

/** The first settings page this ability can open. */
export function firstSettingsPage(ability: Pick<AppAbility, 'can'>): string {
  return (
    SETTINGS_PAGES.find((page) => ability.can(page.action, page.subject))?.href ?? ALWAYS_AVAILABLE
  );
}
