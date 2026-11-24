import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GatewayConfigsPage from '../page';

const createConfig = vi.hoisted(() => vi.fn());
const configs = vi.hoisted(() => ({ list: [] as unknown[] }));
const listConfigs = vi.hoisted(() => vi.fn());
vi.mock('../use-gateway-configs', () => ({
  useGatewayConfigs: () => {
    listConfigs();
    return { configs: configs.list, loading: false };
  },
  useCreateGatewayConfig: () => [createConfig],
  useUpdateGatewayConfig: () => [vi.fn()],
  useDeleteGatewayConfig: () => [vi.fn()],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { resellerBillingGateway: ids } = testIds;

async function openAddDialog() {
  const user = userEvent.setup();
  renderWithProviders(<GatewayConfigsPage />);
  await user.click(await screen.findByRole('button', { name: 'Add Gateway' }));
  return { user, dialog: await screen.findByRole('dialog') };
}

describe('GatewayConfigsPage dialog', () => {
  beforeEach(() => {
    createConfig.mockReset();
    createConfig.mockResolvedValue({ data: {} });
    configs.list = [];
  });

  it('shows the default switch for Razorpay, on when the reseller has no default yet', async () => {
    const { dialog } = await openAddDialog();

    expect(within(dialog).getByTestId(ids.defaultSwitch)).toBeChecked();
  });

  it('starts the default switch off when a default already exists', async () => {
    configs.list = [
      {
        id: 'cfg-1',
        provider: 'RAZORPAY',
        status: 'ACTIVE',
        displayName: 'Existing',
        isDefault: true,
        testMode: false,
        webhookUrl: null,
        upiVpa: null,
      },
    ];
    const { dialog } = await openAddDialog();

    expect(within(dialog).getByTestId(ids.defaultSwitch)).not.toBeChecked();
  });

  it('hides the default switch for UPI_DIRECT and sends isDefault false', async () => {
    const { user, dialog } = await openAddDialog();

    await user.click(within(dialog).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'UPI_DIRECT' }));
    await user.type(
      within(dialog).getByRole('textbox', { name: /UPI VPA Address/ }),
      'roviq@okhdfcbank',
    );

    expect(within(dialog).queryByTestId(ids.defaultSwitch)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Create Gateway' }));
    await waitFor(() => expect(createConfig).toHaveBeenCalledTimes(1));
    expect(createConfig).toHaveBeenCalledWith({
      variables: {
        input: {
          provider: 'UPI_DIRECT',
          displayName: undefined,
          credentials: { VPA: 'roviq@okhdfcbank' },
          webhookSecret: undefined,
          testMode: false,
          isDefault: false,
        },
      },
    });
  });
});

describe('GatewayConfigsPage access (ROV-284)', () => {
  it('should show no gateways and send no query to a role that cannot read them', () => {
    listConfigs.mockClear();
    renderWithProviders(<GatewayConfigsPage />, {
      abilityRules: [{ action: 'read', subject: 'Invoice' }],
    });

    expect(
      screen.getByText('You do not have permission to view payment gateways.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Gateway' })).not.toBeInTheDocument();
    expect(listConfigs).not.toHaveBeenCalled();
  });

  it('should load the gateways for a role that can read them', () => {
    listConfigs.mockClear();
    renderWithProviders(<GatewayConfigsPage />, {
      abilityRules: [{ action: 'read', subject: 'PaymentGatewayConfig' }],
    });

    expect(listConfigs).toHaveBeenCalled();
    expect(
      screen.queryByText('You do not have permission to view payment gateways.'),
    ).not.toBeInTheDocument();
  });
});
