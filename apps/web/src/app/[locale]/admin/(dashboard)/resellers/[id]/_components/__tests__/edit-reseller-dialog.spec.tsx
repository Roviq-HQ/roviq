import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResellerNode } from '../../../types';
import { EditResellerDialog } from '../edit-reseller-dialog';

const updateMock = vi.hoisted(() => vi.fn());
vi.mock('../../../use-resellers', () => ({
  useUpdateReseller: () => [updateMock, { loading: false }],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const reseller: ResellerNode = {
  __typename: 'AdminResellerModel',
  id: 'reseller-1',
  name: 'Acme Partners',
  slug: 'acme-partners',
  tier: 'FULL_MANAGEMENT',
  status: 'ACTIVE',
  isSystem: false,
  isActive: true,
  customDomain: null,
  suspendedAt: null,
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  instituteCount: 0,
  teamSize: 1,
  version: 4,
  registrationNumber: 'U72900RJ2024PTC012345',
  registrationState: 'RAJASTHAN',
  contact: {
    __typename: 'InstituteContactObject',
    phones: [],
    emails: [
      {
        __typename: 'InstituteEmailObject',
        address: 'hello@acme.test',
        isPrimary: true,
        label: 'Main',
      },
    ],
  },
  address: null,
  branding: null,
};

function renderDialog(onStale = vi.fn(), onClose = vi.fn()) {
  renderWithProviders(
    <EditResellerDialog reseller={reseller} open onClose={onClose} onStale={onStale} />,
  );
  return { onStale, onClose };
}

describe('EditResellerDialog', () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it('sends the version, clears emptied fields with null and strips __typename', async () => {
    updateMock.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    const regNo = screen.getByTestId('edit-reseller-registration-number-input');
    await user.clear(regNo);
    const name = screen.getByTestId('edit-reseller-name-input');
    await user.clear(name);
    await user.type(name, 'Acme Channel Partners');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith({
      variables: {
        id: 'reseller-1',
        input: {
          version: 4,
          name: 'Acme Channel Partners',
          customDomain: null,
          registrationNumber: null,
          registrationState: 'RAJASTHAN',
          contact: {
            phones: [],
            emails: [{ address: 'hello@acme.test', isPrimary: true, label: 'Main' }],
          },
          address: null,
        },
      },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('on a stale version shows translated copy and asks the page to reload', async () => {
    updateMock.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [{ message: 'raw server text', extensions: { code: 'CONCURRENT_MODIFICATION' } }],
      }),
    );
    const user = userEvent.setup();
    const { onStale, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      'Someone else changed this reseller. The latest details have been loaded; review them and save again.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
