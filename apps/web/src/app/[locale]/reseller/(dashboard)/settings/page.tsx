'use client';

import { useRouter } from '@roviq/i18n';
import { useAbility } from '@roviq/ui';
import { useEffect } from 'react';

export default function ResellerSettingsIndexPage() {
  const router = useRouter();
  const canReadReseller = useAbility().can('read', 'Reseller');
  useEffect(() => {
    router.replace(canReadReseller ? '/settings/profile' : '/settings/sessions');
  }, [router, canReadReseller]);
  return null;
}
