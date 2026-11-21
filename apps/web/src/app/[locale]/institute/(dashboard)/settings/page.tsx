'use client';

import { useRouter } from '@roviq/i18n';
import { useAbility } from '@roviq/ui';
import * as React from 'react';
import { firstSettingsPage } from './settings-entry';

/** `/settings` has no page of its own: open the first settings page this role can see. */
export default function SettingsIndexPage() {
  const ability = useAbility();
  const router = useRouter();

  React.useEffect(() => {
    router.replace(firstSettingsPage(ability));
  }, [ability, router]);

  return null;
}
