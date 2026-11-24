import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ResellerDashboardPage from '../page';

// The shared setup stubs the locale-aware Link to render nothing; the links are under test.
vi.mock('@roviq/i18n', async () => {
  const actual = await vi.importActual<typeof import('@roviq/i18n')>('@roviq/i18n');
  return {
    ...actual,
    Link: ({ href, children, ...rest }: ComponentProps<'a'>) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
});

describe('ResellerDashboardPage quick links', () => {
  it('should show every link to a role that can open each page', () => {
    renderWithProviders(<ResellerDashboardPage />);

    expect(screen.getByRole('link', { name: 'View Institutes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage Team' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Settings' })).toBeInTheDocument();
  });

  it('should hide the team link from a viewer and keep settings for their sessions (ROV-284)', () => {
    renderWithProviders(<ResellerDashboardPage />, {
      abilityRules: [
        { action: 'read', subject: 'Institute' },
        { action: 'read', subject: 'Invoice' },
      ],
    });

    expect(screen.getByRole('link', { name: 'View Institutes' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage Team' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Settings' })).toBeInTheDocument();
  });
});
