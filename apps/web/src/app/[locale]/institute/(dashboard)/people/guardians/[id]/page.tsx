'use client';

import { useParams } from 'next/navigation';
import { GuardianDetailView } from './guardian-detail-view';

export default function GuardianDetailPage() {
  const params = useParams<{ id: string }>();
  return <GuardianDetailView guardianId={params.id} />;
}
