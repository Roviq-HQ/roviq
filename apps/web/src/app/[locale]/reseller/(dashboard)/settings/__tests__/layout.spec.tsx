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

  // ROV-284: the support and viewer roles do not read the reseller record.
  it('shows only sessions to a role that cannot read the reseller', () => {
    vi.mocked(usePathname).mockReturnValue('/settings/sessions');
    renderWithProviders(
      <ResellerSettingsLayout>
        <p>section body</p>
      </ResellerSettingsLayout>,
      { abilityRules: [{ action: 'read', subject: 'Institute' }] },
    );

    expect(screen.getByTestId('reseller-settings-tab-sessions')).toBeInTheDocument();
    expect(screen.queryByTestId('reseller-settings-tab-profile')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reseller-settings-tab-branding')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reseller-settings-tab-customDomain')).not.toBeInTheDocument();
    expect(screen.getByText('section body')).toBeInTheDocument();
  });

  it('refuses the profile section to a role that cannot read the reseller', () => {
    vi.mocked(usePathname).mockReturnValue('/settings/profile');
    renderWithProviders(
      <ResellerSettingsLayout>
        <p>section body</p>
      </ResellerSettingsLayout>,
      { abilityRules: [{ action: 'read', subject: 'Institute' }] },
    );

    expect(
      screen.getByText('You do not have permission to view the reseller profile.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('section body')).not.toBeInTheDocument();
  });
});
