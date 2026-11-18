'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

export interface MetricCardProps {
  /** Stable key used for the value testid. */
  metricKey: string;
  title: string;
  /** Pre-formatted value; pass `—` for unknown. */
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Secondary line under the value (comparison, unit, last updated). */
  hint?: React.ReactNode;
  /** Extra content under the value, e.g. a `<Sparkline>`. */
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function MetricCard({
  metricKey,
  title,
  value,
  icon: Icon,
  hint,
  children,
  className,
  'data-testid': testId,
}: MetricCardProps) {
  return (
    <Card size="sm" className={className} data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {Icon ? (
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span
          className="text-2xl font-semibold tabular-nums"
          data-testid={testIds.metrics.cardValue(metricKey)}
        >
          {value}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        {children}
      </CardContent>
    </Card>
  );
}
