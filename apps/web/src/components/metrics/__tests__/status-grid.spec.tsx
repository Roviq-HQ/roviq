import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusGrid } from '../status-grid';

describe('StatusGrid', () => {
  it('should render a busy placeholder instead of children while loading', () => {
    render(
      <StatusGrid loading loadingLabel="Loading service health">
        <span>child</span>
      </StatusGrid>,
    );

    const busy = screen.getByTestId(testIds.metrics.statusGridLoading);
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAccessibleName('Loading service health');
    expect(screen.queryByText('child')).not.toBeInTheDocument();
  });

  it('should render children once loaded', () => {
    render(
      <StatusGrid>
        <span>child</span>
      </StatusGrid>,
    );

    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.metrics.statusGridLoading)).not.toBeInTheDocument();
  });
});
