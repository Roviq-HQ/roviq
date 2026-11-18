'use client';

import { cn, Skeleton } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type * as React from 'react';

export interface StatusGridProps {
  children?: React.ReactNode;
  /** Renders `skeletonCount` placeholder tiles instead of children. */
  loading?: boolean;
  skeletonCount?: number;
  /** Accessible name for the busy region while loading. */
  loadingLabel?: string;
  className?: string;
  'data-testid'?: string;
}

/** Responsive tile grid: 1 column on phones, up to 6 on wide screens. */
export function StatusGrid({
  children,
  loading = false,
  skeletonCount = 6,
  loadingLabel,
  className,
  'data-testid': testId,
}: StatusGridProps) {
  const gridClass = cn(
    'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6',
    className,
  );

  if (loading) {
    return (
      <div
        className={gridClass}
        role="status"
        aria-busy="true"
        aria-label={loadingLabel}
        data-testid={testIds.metrics.statusGridLoading}
      >
        {Array.from({ length: skeletonCount }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders with no identity
          <Skeleton key={i} className="h-[124px] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className={gridClass} data-testid={testId}>
      {children}
    </div>
  );
}
