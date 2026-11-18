'use client';

import { testIds } from '@roviq/ui/testing/testid-registry';
import dynamic from 'next/dynamic';

const { metrics } = testIds;

// Recharts touches `window`; load it client-side only and out of the main bundle.
const ResponsiveContainer = dynamic(() => import('recharts').then((m) => m.ResponsiveContainer), {
  ssr: false,
});
const LineChart = dynamic(() => import('recharts').then((m) => m.LineChart), { ssr: false });
const Line = dynamic(() => import('recharts').then((m) => m.Line), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false });

export interface SparklineProps {
  /** Ordered oldest → newest. `null` or empty renders `emptyText`. */
  data: readonly number[] | null;
  /** Accessible summary, e.g. "API calls, last 7 days: 10, 12, 9…". */
  label: string;
  emptyText?: string;
  color?: string;
  width?: number | `${number}%`;
  height?: number;
  className?: string;
}

export function Sparkline({
  data,
  label,
  emptyText = '—',
  color = 'var(--color-primary)',
  width = 96,
  height = 28,
  className,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <span className="text-muted-foreground" data-testid={metrics.sparklineEmpty}>
        {emptyText}
      </span>
    );
  }

  const points = data.map((v, i) => ({ i, v }));

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={className}
      style={{ width, height }}
      data-testid={metrics.sparkline}
      data-points={data.join(',')}
    >
      {/* A seed size stops Recharts warning about a -1 width before it measures. */}
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: typeof width === 'number' ? width : 1, height }}
      >
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
