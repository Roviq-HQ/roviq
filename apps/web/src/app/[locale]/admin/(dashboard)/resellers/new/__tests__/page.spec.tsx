import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createResellerMock = vi.fn();
vi.mock('../../use-resellers', () => ({
  useCreateReseller: () => [createResellerMock, { loading: false }],
}));

const pushMock = vi.fn();
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import adminResellersMessages from '../../../../../../../../messages/en/adminResellers.json';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import NewResellerPage from '../page';

const messages = { adminResellers: adminResellersMessages };

describe('NewResellerPage', () => {
  beforeEach(() => {
    createResellerMock.mockReset();
    pushMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the title, description and back button', () => {
    renderWithProviders(<NewResellerPage />, { messages });
    expect(screen.getByTestId('new-reseller-title')).toHaveTextContent('Create Reseller');
    expect(screen.getByTestId('back-to-resellers-btn')).toBeInTheDocument();
  });

  it('renders all required field inputs', () => {
    renderWithProviders(<NewResellerPage />, { messages });
    expect(screen.getByTestId('reseller-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('reseller-slug-input')).toBeInTheDocument();
    expect(screen.getByTestId('reseller-tier-select')).toBeInTheDocument();
    expect(screen.getByTestId('reseller-admin-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('reseller-custom-domain-input')).toBeInTheDocument();
    expect(screen.getByTestId('reseller-logo-url-input')).toBeInTheDocument();
  });

  it('blocks submission and does not call the create mutation when required fields are blank', async () => {
    renderWithProviders(<NewResellerPage />, { messages });
    const submit = screen.getByTestId('submit-create-reseller-btn');
    await userEvent.click(submit);

    await waitFor(() => {
      expect(createResellerMock).not.toHaveBeenCalled();
    });
  });

  it('navigates back to the list when Cancel is clicked', async () => {
    renderWithProviders(<NewResellerPage />, { messages });
    await userEvent.click(screen.getByTestId('cancel-create-reseller-btn'));
    expect(pushMock).toHaveBeenCalledWith('/admin/resellers');
  });

  it('submits the form with valid data and pushes to the detail page on success', async () => {
    createResellerMock.mockResolvedValueOnce({
      data: { adminCreateReseller: { id: 'new-reseller-id' } },
    });

    renderWithProviders(<NewResellerPage />, { messages });

    await userEvent.type(screen.getByTestId('reseller-name-input'), 'Acme Partners');
    await userEvent.type(screen.getByTestId('reseller-admin-email-input'), 'admin@acme.test');

    await userEvent.click(screen.getByTestId('submit-create-reseller-btn'));

    await waitFor(() => {
      expect(createResellerMock).toHaveBeenCalledTimes(1);
    });

    const call = createResellerMock.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.variables.input.name).toBe('Acme Partners');
    expect(call.variables.input.initialAdminEmail).toBe('admin@acme.test');
    expect(call.variables.input.tier).toBe('FULL_MANAGEMENT');
    // When branding fields are blank, branding must be OMITTED from the input
    // — sending an empty object would clobber existing server-side branding.
    expect(call.variables.input.branding).toBeUndefined();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/admin/resellers/new-reseller-id');
    });
  });

  function serverError(code: string) {
    return new CombinedGraphQLErrors({
      errors: [{ message: 'raw server text', extensions: { code } }],
    });
  }

  async function fillAndSubmit() {
    await userEvent.type(screen.getByTestId('reseller-name-input'), 'Acme Partners');
    await userEvent.type(screen.getByTestId('reseller-admin-email-input'), 'admin@acme.test');
    await userEvent.click(screen.getByTestId('submit-create-reseller-btn'));
  }

  it('shows SLUG_DUPLICATE inline on the slug field instead of a toast', async () => {
    createResellerMock.mockRejectedValueOnce(serverError('SLUG_DUPLICATE'));
    renderWithProviders(<NewResellerPage />, { messages });

    await fillAndSubmit();

    expect(
      await screen.findByText(adminResellersMessages.errors.SLUG_DUPLICATE),
    ).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('clears the slug error and allows resubmitting once the slug is edited', async () => {
    createResellerMock.mockRejectedValueOnce(serverError('SLUG_DUPLICATE')).mockResolvedValueOnce({
      data: { adminCreateReseller: { id: 'new-reseller-id' } },
    });
    renderWithProviders(<NewResellerPage />, { messages });

    await fillAndSubmit();
    await screen.findByText(adminResellersMessages.errors.SLUG_DUPLICATE);

    await userEvent.type(screen.getByTestId('reseller-slug-input'), 'acme-two');
    expect(
      screen.queryByText(adminResellersMessages.errors.SLUG_DUPLICATE),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('submit-create-reseller-btn'));

    await waitFor(() => expect(createResellerMock).toHaveBeenCalledTimes(2));
    expect(createResellerMock.mock.calls[1]?.[0].variables.input.slug).toBe('acme-two');
  });

  it('shows translated copy, never the raw server message, for other failures', async () => {
    createResellerMock.mockRejectedValueOnce(serverError('RESELLER_ADMIN_EMAIL_UNAVAILABLE'));
    renderWithProviders(<NewResellerPage />, { messages });

    await fillAndSubmit();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        adminResellersMessages.errors.RESELLER_ADMIN_EMAIL_UNAVAILABLE,
      ),
    );
  });

  it('rejects invalid slug (uppercase / trailing hyphen)', async () => {
    renderWithProviders(<NewResellerPage />, { messages });

    await userEvent.type(screen.getByTestId('reseller-name-input'), 'Acme Partners');
    await userEvent.type(screen.getByTestId('reseller-slug-input'), 'Acme-Partners-');
    await userEvent.type(screen.getByTestId('reseller-admin-email-input'), 'admin@acme.test');

    await userEvent.click(screen.getByTestId('submit-create-reseller-btn'));

    await waitFor(() => {
      expect(createResellerMock).not.toHaveBeenCalled();
    });
  });

  it('rejects invalid email format', async () => {
    renderWithProviders(<NewResellerPage />, { messages });

    await userEvent.type(screen.getByTestId('reseller-name-input'), 'Acme Partners');
    await userEvent.type(screen.getByTestId('reseller-admin-email-input'), 'not-an-email');

    await userEvent.click(screen.getByTestId('submit-create-reseller-btn'));

    await waitFor(() => {
      expect(createResellerMock).not.toHaveBeenCalled();
    });
  });

  it('sends branding when a populated color/url field is provided', async () => {
    createResellerMock.mockResolvedValueOnce({
      data: { adminCreateReseller: { id: 'new-reseller-id' } },
    });

    renderWithProviders(<NewResellerPage />, { messages });

    await userEvent.type(screen.getByTestId('reseller-name-input'), 'Acme Partners');
    await userEvent.type(screen.getByTestId('reseller-admin-email-input'), 'admin@acme.test');
    await userEvent.type(screen.getByTestId('reseller-primary-color-input'), '#1677FF');

    await userEvent.click(screen.getByTestId('submit-create-reseller-btn'));

    await waitFor(() => {
      expect(createResellerMock).toHaveBeenCalledTimes(1);
    });

    const call = createResellerMock.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.variables.input.branding).toEqual({ primaryColor: '#1677FF' });
  });
});
