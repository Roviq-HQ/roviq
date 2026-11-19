import { usePathname } from '@roviq/i18n';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ResellerSettingsLayout from '../layout';

vi.mock('@roviq/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/i18n')>()),
  usePathname: vi.fn(),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('ResellerSettingsLayout', () => {
  it('links the four sections and marks the one being viewed', () => {
    vi.mocked(usePathname).mockReturnValue('/settings/branding');
    renderWithProviders(
      <ResellerSettingsLayout>
        <p>section body</p>
      </ResellerSettingsLayout>,
    );

    expect(screen.getByTestId('reseller-settings-tab-profile')).toHaveAttribute(
      'href',
      '/settings/profile',
    );
    expect(screen.getByTestId('reseller-settings-tab-customDomain')).toHaveAttribute(
      'href',
      '/settings/custom-domain',
    );
    expect(screen.getByTestId('reseller-settings-tab-sessions')).toHaveAttribute(
      'href',
      '/settings/sessions',
    );
    expect(screen.getByTestId('reseller-settings-tab-branding')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByTestId('reseller-settings-tab-profile')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('section body')).toBeInTheDocument();
  });
});
