'use client';

import { useParams } from 'next/navigation';
import { StudentDetailView } from './student-detail-view';

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  return <StudentDetailView studentId={params.id} />;
}
