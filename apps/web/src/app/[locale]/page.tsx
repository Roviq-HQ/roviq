'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    // Default redirect to institute login
    // Hostname middleware will handle scope routing
    router.replace('/institute/login');
  }, [router]);

  return null;
}
