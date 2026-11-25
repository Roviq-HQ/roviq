import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { GraphQLError } from 'graphql';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResellerProfilePage from '../profile/page';
import { ResellerUpdateProfileDocument } from '../use-reseller-settings.generated';
import { buildProfile, FULL_ADMIN, profileMock, VIEWER } from './fixtures';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Radix Select needs these in jsdom.
if (typeof Element.prototype.hasPointerCapture === 'undefined') {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ResellerProfilePage', () => {
  it('shows the editable name and the fixed slug, tier and status', async () => {
    renderWithProviders(<ResellerProfilePage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: FULL_ADMIN,
    });

    expect(await screen.findByTestId('reseller-settings-name-input')).toHaveValue('Acme Partners');
    expect(screen.getByTestId('reseller-settings-name-input')).toBeEnabled();
    expect(screen.getByTestId('reseller-settings-profile-slug')).toHaveTextContent('acme-partners');
    expect(screen.getByTestId('reseller-settings-profile-tier')).toHaveTextContent(
      'Full Management',
    );
    expect(screen.getByTestId('reseller-settings-profile-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('reseller-settings-registration-number-input')).toHaveValue(
      'U80301RJ2020PTC012345',
    );
    expect(screen.getByTestId('reseller-settings-profile-save-btn')).toBeDisabled();
  });

  it('saves the edited fields under the loaded version', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResellerProfilePage />, {
      apolloMocks: [
        profileMock(buildProfile()),
        {
          request: {
            query: ResellerUpdateProfileDocument,
            variables: {
              input: {
                version: 4,
                name: 'Acme Education',
                registrationNumber: null,
                registrationState: 'RAJASTHAN',
                contact: { phones: [], emails: [] },
                address: null,
              },
            },
          },
          result: {
            data: {
              resellerUpdateProfile: buildProfile({
                version: 5,
                name: 'Acme Education',
                registrationNumber: null,
              }),
            },
          },
        },
      ],
      abilityRules: FULL_ADMIN,
    });

    const name = await screen.findByTestId('reseller-settings-name-input');
    await user.clear(name);
    await user.type(name, 'Acme Education');
    await user.clear(screen.getByTestId('reseller-settings-registration-number-input'));
    await user.click(screen.getByTestId('reseller-settings-profile-save-btn'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changes saved'));
    await waitFor(() =>
      expect(screen.getByTestId('reseller-settings-profile-save-btn')).toBeDisabled(),
    );
    expect(screen.getByTestId('reseller-settings-name-input')).toHaveValue('Acme Education');
  });

  it('locks the name of the system reseller and never sends it', async () => {
    const user = userEvent.setup();
    const system = buildProfile({ isSystem: true, name: 'Roviq Direct', slug: 'roviq-direct' });
    renderWithProviders(<ResellerProfilePage />, {
      apolloMocks: [
        profileMock(system),
        {
          request: {
            query: ResellerUpdateProfileDocument,
            variables: {
              input: {
                version: 4,
                registrationNumber: 'NEW-1',
                registrationState: 'RAJASTHAN',
                contact: { phones: [], emails: [] },
                address: null,
              },
            },
          },
          result: {
            data: {
              resellerUpdateProfile: { ...system, version: 5, registrationNumber: 'NEW-1' },
            },
          },
        },
      ],
      abilityRules: FULL_ADMIN,
    });

    expect(await screen.findByTestId('reseller-settings-name-input')).toBeDisabled();
    expect(screen.getByText('The name of the Roviq Direct reseller is fixed.')).toBeInTheDocument();

    const registration = screen.getByTestId('reseller-settings-registration-number-input');
    await user.clear(registration);
    await user.type(registration, 'NEW-1');
    await user.click(screen.getByTestId('reseller-settings-profile-save-btn'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changes saved'));
  });

  it('blocks a name shorter than two characters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResellerProfilePage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: FULL_ADMIN,
    });

    const name = await screen.findByTestId('reseller-settings-name-input');
    await user.clear(name);
    await user.type(name, 'A');

    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    vi.mocked(toast.error).mockClear();
    const save = screen.getByTestId('reseller-settings-profile-save-btn');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(name).toHaveFocus());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows translated copy when the server refuses the change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResellerProfilePage />, {
      apolloMocks: [
        profileMock(buildProfile()),
        {
          request: {
            query: ResellerUpdateProfileDocument,
            variables: {
              input: {
                version: 4,
                name: 'Acme Partners',
                registrationNumber: null,
                registrationState: 'RAJASTHAN',
                contact: { phones: [], emails: [] },
                address: null,
              },
            },
          },
          result: {
            errors: [new GraphQLError('no', { extensions: { code: 'FORBIDDEN' } })],
          },
        },
      ],
      abilityRules: FULL_ADMIN,
    });

    await screen.findByTestId('reseller-settings-name-input');
    await user.clear(screen.getByTestId('reseller-settings-registration-number-input'));
    await user.click(screen.getByTestId('reseller-settings-profile-save-btn'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Only a full admin can change these settings.'),
    );
  });

  it('is read-only for a role that cannot update the reseller', async () => {
    renderWithProviders(<ResellerProfilePage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: VIEWER,
    });

    expect(await screen.findByTestId('reseller-settings-read-only-notice')).toHaveTextContent(
      'Only a full admin can change them.',
    );
    expect(screen.getByTestId('reseller-settings-name-input')).toBeDisabled();
    expect(screen.getByTestId('reseller-settings-registration-number-input')).toBeDisabled();
    expect(screen.queryByTestId('reseller-settings-profile-save-btn')).not.toBeInTheDocument();
  });
});
