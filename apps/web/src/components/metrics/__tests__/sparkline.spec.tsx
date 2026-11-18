import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from '../sparkline';

describe('Sparkline', () => {
  it('should expose the series through an accessible image label', () => {
    render(<Sparkline data={[1, 4, 2]} label="API calls: 1, 4, 2" />);

    const chart = screen.getByRole('img', { name: 'API calls: 1, 4, 2' });
    expect(chart).toHaveAttribute('data-points', '1,4,2');
  });

  it('should render the empty text for null data', () => {
    render(<Sparkline data={null} label="API calls" />);

    expect(screen.getByTestId(testIds.metrics.sparklineEmpty)).toHaveTextContent('—');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('should render the empty text for an empty series', () => {
    render(<Sparkline data={[]} label="API calls" emptyText="n/a" />);

    expect(screen.getByTestId(testIds.metrics.sparklineEmpty)).toHaveTextContent('n/a');
  });
});
