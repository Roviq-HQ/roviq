'use client';

import { Skeleton } from '@roviq/ui';
import { useState } from 'react';
import { authFetch, errMessage, sanitizeServiceNames } from '../_lib/auth-fetch';
import type { TimeRange } from '../_lib/constants';
import { METRIC_INFO } from '../_lib/metric-descriptions';
import { usePollingEffect } from '../_lib/polling';
import { PanelShell } from './panel-shell';

interface LogHit {
  _timestamp?: number;
  severity?: string;
  service_name?: string;
  body?: string;
}

interface LogSearchResponse {
  hits?: LogHit[];
  error?: string;
  message?: string;
}

interface LogLine {
  // Several lines can share a millisecond and a message, so the position is part of the key.
  key: string;
  ts: number;
  level: string;
  service: string;
  message: string;
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-500',
  warn: 'text-amber-500',
  info: 'text-sky-500',
  debug: 'text-muted-foreground',
};

interface RecentLogsPanelProps {
  range: TimeRange;
  refreshMs: number | null;
  services: string[];
  className?: string;
  headerRight?: React.ReactNode;
}

function toLogLines(hits: LogHit[]): LogLine[] {
  return hits.map((hit, index) => {
    let level = hit.severity ?? 'info';
    let message = hit.body ?? '';
    try {
      const parsed = JSON.parse(message) as { level?: string; msg?: string; message?: string };
      if (parsed.level) level = parsed.level;
      const text = parsed.msg ?? parsed.message;
      if (text) message = text;
    } catch {
      // plain-text body
    }
    const ts = Math.floor((hit._timestamp ?? 0) / 1_000);
    return {
      key: `${ts}-${index}`,
      ts,
      level: level.toLowerCase(),
      service: hit.service_name ?? '–',
      message,
    };
  });
}

export function RecentLogsPanel({
  range,
  refreshMs,
  services,
  className,
  headerRight,
}: RecentLogsPanelProps) {
  const [logs, setLogs] = useState<LogLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const sinceSeconds = range.seconds;
  const serviceList = sanitizeServiceNames(services).join(',');

  usePollingEffect(
    async () => {
      try {
        const params = new URLSearchParams({
          limit: '50',
          sinceSeconds: String(sinceSeconds),
        });
        if (serviceList) params.set('services', serviceList);
        const res = await authFetch(`/api/logs?${params}`);
        const body = (await res.json()) as LogSearchResponse;
        if (!res.ok) {
          setError(body.error ?? body.message ?? `logs query failed (HTTP ${res.status})`);
          return;
        }
        setLogs(toLogLines(body.hits ?? []));
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
      title={METRIC_INFO.recentLogs.title}
      description={METRIC_INFO.recentLogs.description}
      className={className}
      headerRight={headerRight}
      lastFetchedAt={lastFetchedAt}
    >
      <div className="h-full max-h-[360px] min-h-[180px] overflow-auto font-mono text-[11px]">
        {error ? (
          <div className="flex h-full items-center justify-center text-xs text-destructive">
            {error}
          </div>
        ) : !logs ? (
          <Skeleton className="h-full w-full" />
        ) : logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No logs in this range
          </div>
        ) : (
          <ul className="space-y-0.5">
            {logs.map((line) => (
              <li
                key={line.key}
                className="flex gap-2 border-b border-border/40 px-1 py-1 last:border-0"
              >
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {new Date(line.ts).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span
                  className={`w-12 shrink-0 uppercase ${LOG_LEVEL_COLORS[line.level] ?? 'text-muted-foreground'}`}
                >
                  {line.level}
                </span>
                <span className="shrink-0 text-muted-foreground">[{line.service}]</span>
                <span className="break-all">{line.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PanelShell>
  );
}
