import '@testing-library/jest-dom/vitest';
import assert from 'node:assert';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import adminMessagesEn from '../../../../../../../../messages/en/adminInstitutes.json';

const createInstituteMock = vi.fn();

vi.mock('../../use-institutes', () => ({
  useCreateInstitute: () => [createInstituteMock, { loading: false }],
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

import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import CreateInstitutePage from '../page';

/** Restores a complete school draft, then fills the phone and departments the draft lacks. */
async function restoreAndCompleteDraft() {
  window.localStorage.setItem(
    'roviq:draft:adminCreateInstitute:new',
    JSON.stringify({
      savedAt: Date.now(),
      values: {
        name: { en: 'Sunrise Academy' },
        code: 'SUN-01',
        type: 'SCHOOL',
        structureFramework: 'TRADITIONAL',
        board: 'CBSE',
        departments: [],
        contact: {
          phones: [
            {
              countryCode: '+91',
              number: '',
              isPrimary: true,
              isWhatsappEnabled: true,
              label: '',
            },
          ],
          emails: [{ address: 'office@sunrise.example', isPrimary: true, label: '' }],
        },
        address: {
          line1: '12 Main Road',
          line2: '',
          line3: '',
          city: 'Gurugram',
          district: 'Gurugram',
          state: 'HARYANA',
          postalCode: '122001',
          country: 'IN',
        },
        resellerId: null,
        groupId: null,
        isDemo: false,
        firstAdmin: {
          firstName: 'Meera',
          lastName: '',
          email: 'meera@sunrise.example',
          phone: '',
        },
      },
    }),
  );
  renderWithProviders(<CreateInstitutePage />);

  await userEvent.click(await screen.findByTestId(testIds.adminInstitutes.newDraftRestoreBtn));
  const phone = screen.getByTestId('admin-institute-new-phone-0-input');
  await userEvent.type(phone, '9876512399');
  fireEvent.blur(phone);
  await waitFor(() => expect(phone).toHaveValue('98765 12399'));
  expect(phone).not.toHaveAttribute('aria-invalid');
  await userEvent.click(screen.getByTestId('admin-institute-new-department-PRIMARY'));
  const adminPhone = screen.getByTestId(testIds.adminInstitutes.newFirstAdminPhone);
  await userEvent.type(adminPhone, '9812345678');
  fireEvent.blur(adminPhone);
  await waitFor(() => expect(adminPhone).toHaveValue('98123 45678'));
}

async function submit() {
  const button = screen
    .getAllByRole('button', { name: /create institute/i })
    .find((b) => (b as HTMLButtonElement).type === 'submit');
  assert(button);
  await userEvent.click(button);
}

describe('CreateInstitutePage (admin)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    createInstituteMock.mockReset();
    pushMock.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the page heading and the i18n name input', () => {
    renderWithProviders(<CreateInstitutePage />);

    // Title is "Create Institute" and appears in both the H1 and the card.
    expect(screen.getAllByText(/create institute/i).length).toBeGreaterThan(0);
    // I18nInput renders one input per locale. The "name.en" placeholder
    // comes from adminInstitutes.create.namePlaceholder.
    expect(
      screen
        .getAllByPlaceholderText(/.+/)
        .some((el) => (el as HTMLInputElement).name === 'name.en'),
    ).toBe(true);
  });

  it('blocks submission and surfaces errors when the i18n name is blank', async () => {
    renderWithProviders(<CreateInstitutePage />);

    const submit = screen
      .getAllByRole('button', { name: /create institute/i })
      .find((b) => (b as HTMLButtonElement).type === 'submit');
    if (!submit) throw new Error('submit button not found');
    await userEvent.click(submit);

    // After a blank submit the createInstitute mutation must NOT be called,
    // and at least one input across the form must be flagged invalid.
    await waitFor(() => {
      expect(createInstituteMock).not.toHaveBeenCalled();
      const anyInvalid = screen
        .getAllByRole('textbox')
        .some((el) => el.getAttribute('aria-invalid') === 'true');
      expect(anyInvalid).toBe(true);
    });
  });

  it('does not leak NaN errors for blank lat/lng coordinates (regression)', async () => {
    createInstituteMock.mockResolvedValue({ data: { createInstitute: { id: 'inst-1' } } });
    renderWithProviders(<CreateInstitutePage />);

    const submit = screen
      .getAllByRole('button', { name: /create institute/i })
      .find((b) => (b as HTMLButtonElement).type === 'submit');
    if (!submit) throw new Error('submit button not found');
    await userEvent.click(submit);

    // Even with the form invalid (we don't fill in name), it must NEVER
    // surface a raw Zod "expected number, received NaN" error from the
    // empty coordinate inputs.
    await waitFor(() => {
      expect(screen.queryByText(/expected number/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/received NaN/i)).not.toBeInTheDocument();
    });
  });

  it('submits a school with a phone formatted on blur and enum board and departments', async () => {
    createInstituteMock.mockResolvedValue({ data: { adminCreateInstitute: { id: 'inst-1' } } });
    await restoreAndCompleteDraft();
    await submit();

    await waitFor(() => expect(createInstituteMock).toHaveBeenCalledTimes(1));
    const input = createInstituteMock.mock.calls[0]?.[0]?.variables?.input;
    assert(input);
    expect(input.board).toBe('CBSE');
    expect(input.departments).toEqual(['PRIMARY']);
    expect(input.firstAdmin).toEqual({
      firstName: 'Meera',
      lastName: undefined,
      email: 'meera@sunrise.example',
      phone: '9812345678',
    });
    expect(input.contact.phones).toEqual([
      {
        countryCode: '+91',
        number: '9876512399',
        isPrimary: true,
        isWhatsappEnabled: true,
        label: '',
      },
    ]);
  });

  it('marks the first admin email when no account can be resolved from it', async () => {
    createInstituteMock.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [
          { message: 'raw server text', extensions: { code: 'INSTITUTE_ADMIN_UNAVAILABLE' } },
        ],
      }),
    );
    await restoreAndCompleteDraft();
    await submit();

    const message = adminMessagesEn.create.firstAdmin.unavailable;
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(screen.getByTestId(testIds.adminInstitutes.newFirstAdminEmail)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(await screen.findAllByText(message)).not.toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows the length error for an 11-digit first admin mobile instead of cutting it', async () => {
    renderWithProviders(<CreateInstitutePage />);
    const phone = screen.getByTestId(testIds.adminInstitutes.newFirstAdminPhone);
    await userEvent.type(phone, '98765432101');
    fireEvent.blur(phone);

    expect(phone).toHaveValue('98765432101');
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(
      await screen.findByText(adminMessagesEn.create.firstAdmin.phoneInvalid),
    ).toBeInTheDocument();
  });
});
