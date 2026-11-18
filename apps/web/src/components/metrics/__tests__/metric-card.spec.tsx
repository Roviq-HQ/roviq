import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricCard } from '../metric-card';

describe('MetricCard', () => {
  it('should render the title, value and hint', () => {
    render(<MetricCard metricKey="ws" title="Real-time" value="42" hint="Every 10 seconds" />);

    expect(screen.getByText('Real-time')).toBeInTheDocument();
    expect(screen.getByTestId(testIds.metrics.cardValue('ws'))).toHaveTextContent('42');
    expect(screen.getByText('Every 10 seconds')).toBeInTheDocument();
  });

  it('should render extra content such as a trend', () => {
    render(
      <MetricCard metricKey="http" title="HTTP" value="—">
        <span>trend</span>
      </MetricCard>,
    );

    expect(screen.getByTestId(testIds.metrics.cardValue('http'))).toHaveTextContent('—');
    expect(screen.getByText('trend')).toBeInTheDocument();
  });
});
