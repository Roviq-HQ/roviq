'use client';

import { Skeleton } from '@roviq/ui';
import { useState } from 'react';
import { authFetch, errMessage, sanitizeServiceNames } from '../_lib/auth-fetch';
import type { TimeRange } from '../_lib/constants';
import { METRIC_INFO } from '../_lib/metric-descriptions';
import { openObserveTraceUrl } from '../_lib/openobserve-links';
import { usePollingEffect } from '../_lib/polling';
import { PanelShell } from './panel-shell';

interface TraceHit {
  _timestamp?: number;
  trace_id?: string;
  service_name?: string;
  operation_name?: string;
  duration?: number;
}

interface TraceSearchResponse {
  hits?: TraceHit[];
  error?: string;
  message?: string;
}

interface RecentTracesPanelProps {
  range: TimeRange;
  refreshMs: number | null;
  services: string[];
  className?: string;
  openObserveUrl: string;
  headerRight?: React.ReactNode;
}

export function RecentTracesPanel({
  range,
  refreshMs,
  services,
  className,
  openObserveUrl,
  headerRight,
}: RecentTracesPanelProps) {
  const [traces, setTraces] = useState<TraceHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const sinceSeconds = range.seconds;
  const serviceList = sanitizeServiceNames(services).join(',');

  usePollingEffect(
    async () => {
      try {
        // The route filters out health checks and introspection server-side.
        const params = new URLSearchParams({ limit: '20', sinceSeconds: String(sinceSeconds) });
        if (serviceList) params.set('services', serviceList);
        const res = await authFetch(`/api/traces?${params}`);
        const body = (await res.json()) as TraceSearchResponse;
        if (!res.ok) {
          setError(body.error ?? body.message ?? `traces query failed (HTTP ${res.status})`);
          return;
        }
        setTraces((body.hits ?? []).filter((t) => Boolean(t.trace_id)));
        setLastFetchedAt(Date.now());
        setError(null);
      } catch (err) {
        setError(errMessage(err));
      }
    },
    { refreshMs, deps: [sinceSeconds, serviceList] },
  );

  return (
    <PanelShell
      title={METRIC_INFO.recentTraces.title}
      description={METRIC_INFO.recentTraces.description}
      className={className}
      headerRight={headerRight}
      lastFetchedAt={lastFetchedAt}
    >
      <div className="h-full max-h-[360px] min-h-[180px] overflow-auto">
        {error ? (
          <div className="flex h-full items-center justify-center text-xs text-destructive">
            {error}
          </div>
        ) : !traces ? (
          <Skeleton className="h-full w-full" />
        ) : traces.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No traces in this range
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr className="border-b">
                <th className="px-2 py-1.5 text-left font-medium">Service</th>
                <th className="px-2 py-1.5 text-left font-medium">Trace</th>
                <th className="px-2 py-1.5 text-right font-medium">Duration</th>
                <th className="px-2 py-1.5 text-right font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => {
                const traceId = trace.trace_id ?? '';
                const startedUs = trace._timestamp ?? 0;
                const startedMs = Math.floor(startedUs / 1_000);
                const durationMs =
                  trace.duration !== undefined ? Math.round(trace.duration / 1_000) : null;
                const startedAt = startedMs
                  ? new Date(startedMs).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : '–';
                return (
                  <tr key={traceId} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-2 py-1.5 font-mono text-[11px]">
                      {trace.service_name ?? '–'}
                    </td>
                    <td className="truncate px-2 py-1.5">
                      <a
                        href={openObserveTraceUrl(openObserveUrl, traceId, startedUs)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {trace.operation_name ?? traceId.slice(0, 16)}
                      </a>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {durationMs !== null ? `${durationMs} ms` : '–'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {startedAt}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </PanelShell>
  );
}
