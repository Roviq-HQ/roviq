import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import errorEn from '../../../../../../../messages/en/error.json';
import errorHi from '../../../../../../../messages/hi/error.json';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';

const { instituteAcademics: ids } = testIds;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/academics',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

vi.mock('nuqs', () => ({
  useQueryState: () => ['year-2026', vi.fn()],
  parseAsString: {},
}));

vi.mock('@web/components/pickers/academic-year-picker', () => ({
  AcademicYearSelector: () => null,
}));

const createStandardMock = vi.fn();

vi.mock('../use-academics', () => ({
  useStandards: () => ({ standards: [], loading: false, error: undefined, refetch: vi.fn() }),
  useCreateStandard: () => ({ createStandard: createStandardMock, loading: false }),
  useUpdateStandard: () => ({ updateStandard: vi.fn(), loading: false }),
  useDeleteStandard: () => ({ deleteStandard: vi.fn(), loading: false }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import AcademicsPage from '../page';

function rejectWith(code: string) {
  createStandardMock.mockRejectedValue(
    new CombinedGraphQLErrors({ errors: [{ message: 'raw server text', extensions: { code } }] }),
  );
}

async function submitNewStandard(locale: 'en' | 'hi', submitLabel: string) {
  renderWithProviders(<AcademicsPage />, { locale });
  // The header and the empty state both offer the button.
  await userEvent.click(screen.getAllByTestId(ids.newBtn)[0]);
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getAllByRole('textbox')[0], 'Class 1');
  await userEvent.click(within(dialog).getByRole('button', { name: submitLabel }));
  return dialog;
}

describe('AcademicsPage new standard (ROV-358)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createStandardMock.mockReset();
  });

  it('shows a taken name on the name field', async () => {
    rejectWith('STANDARD_NAME_DUPLICATE');
    const dialog = await submitNewStandard('en', 'New Standard');

    expect(await within(dialog).findByText(errorEn.STANDARD_NAME_DUPLICATE)).toBeInTheDocument();
    expect(within(dialog).queryByText('raw server text')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows a taken name in Hindi', async () => {
    rejectWith('STANDARD_NAME_DUPLICATE');
    const dialog = await submitNewStandard('hi', 'नई क्लास');

    expect(await within(dialog).findByText(errorHi.STANDARD_NAME_DUPLICATE)).toBeInTheDocument();
  });

  it('shows a taken order on the order field', async () => {
    rejectWith('STANDARD_ORDER_DUPLICATE');
    const dialog = await submitNewStandard('en', 'New Standard');

    const message = await within(dialog).findByText(errorEn.STANDARD_ORDER_DUPLICATE);
    expect(message).toBeInTheDocument();
    expect(within(dialog).getByRole('spinbutton', { name: /^Order/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('shows any other failure as a translated toast', async () => {
    rejectWith('FORBIDDEN');
    await submitNewStandard('en', 'New Standard');

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(errorEn.FORBIDDEN));
  });
});
