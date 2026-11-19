import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it } from 'vitest';
import ResellerCustomDomainPage from '../custom-domain/page';
import { buildProfile, profileMock, VIEWER } from './fixtures';

describe('ResellerCustomDomainPage', () => {
  it('says the feature is coming, shows the address in use and a support link', async () => {
    renderWithProviders(<ResellerCustomDomainPage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: VIEWER,
    });

    expect(await screen.findByTestId('reseller-settings-domain-notice')).toHaveTextContent(
      'Custom domain support is coming soon.',
    );
    expect(screen.getByTestId('reseller-settings-domain-current-url')).toHaveTextContent(
      window.location.host,
    );
    expect(screen.getByTestId('reseller-settings-domain-support-link')).toHaveAttribute(
      'href',
      'mailto:support@roviq.com',
    );
  });

  it('shows the stored domain in a disabled field', async () => {
    renderWithProviders(<ResellerCustomDomainPage />, {
      apolloMocks: [profileMock(buildProfile({ customDomain: 'portal.acme.example' }))],
      abilityRules: VIEWER,
    });

    const input = await screen.findByTestId('reseller-settings-domain-input');
    expect(input).toHaveValue('portal.acme.example');
    expect(input).toBeDisabled();
  });

  it('shows an empty disabled field when no domain is set', async () => {
    renderWithProviders(<ResellerCustomDomainPage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: VIEWER,
    });

    const input = await screen.findByTestId('reseller-settings-domain-input');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'No custom domain set');
  });
});
