'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { AlertTriangle, CheckCircle2, type LucideIcon, XCircle } from 'lucide-react';
import type { HealthStatus } from './types';

const { metrics } = testIds;

const STATUS_STYLE: Record<HealthStatus, { icon: LucideIcon; badge: string; ring: string }> = {
  healthy: {
    icon: CheckCircle2,
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    ring: 'ring-emerald-500/30',
  },
  degraded: {
    icon: AlertTriangle,
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    ring: 'ring-amber-500/40',
  },
  down: {
    icon: XCircle,
    badge: 'bg-destructive/10 text-destructive',
    ring: 'ring-destructive/50',
  },
};

export interface ServiceCardLabels {
  status: Record<HealthStatus, string>;
  responseTime: string;
  uptime: string;
  /** Shown for a null metric. */
  unknown: string;
}

export interface ServiceCardProps {
  /** Stable key (e.g. the service enum) used for testids. */
  serviceKey: string;
  name: string;
  status: HealthStatus;
  /** Already formatted, e.g. "12 ms"; null renders `labels.unknown`. */
  responseTime: string | null;
  /** Already formatted, e.g. "99.9%"; null renders `labels.unknown`. */
  uptime: string | null;
  labels: ServiceCardLabels;
  className?: string;
  'data-testid'?: string;
}

export function ServiceCard({
  serviceKey,
  name,
  status,
  responseTime,
  uptime,
  labels,
  className,
  'data-testid': testId,
}: ServiceCardProps) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;

  return (
    <Card
      size="sm"
      className={cn('ring-2', style.ring, className)}
      data-testid={testId}
      data-status={status}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="truncate text-sm font-semibold">{name}</CardTitle>
        <Badge
          className={cn('shrink-0', style.badge)}
          data-testid={metrics.serviceStatus(serviceKey)}
        >
          <Icon aria-hidden="true" />
          {labels.status[status]}
        </Badge>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{labels.responseTime}</dt>
            <dd
              className="text-base font-medium tabular-nums"
              data-testid={metrics.serviceResponse(serviceKey)}
            >
              {responseTime ?? labels.unknown}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{labels.uptime}</dt>
            <dd
              className="text-base font-medium tabular-nums"
              data-testid={metrics.serviceUptime(serviceKey)}
            >
              {uptime ?? labels.unknown}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
