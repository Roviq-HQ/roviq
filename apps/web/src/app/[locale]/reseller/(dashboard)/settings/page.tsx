'use client';

import { useRouter } from '@roviq/i18n';
import { useEffect } from 'react';

export default function ResellerSettingsIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings/profile');
  }, [router]);
  return null;
}
