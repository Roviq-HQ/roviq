import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import errorEn from '../../../../../../../../messages/en/error.json';

const { instituteGroups: ids } = testIds;

const mocks = vi.hoisted(() => ({ createGroup: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/groups/new',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

vi.mock('../../use-groups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../use-groups')>()),
  useCreateGroup: () => [mocks.createGroup, { loading: false }],
  usePreviewGroupRule: () => [vi.fn(), { loading: false }],
}));

vi.mock('../../../people/students/use-students', () => ({
  useStudents: () => ({ students: [], loading: false }),
}));
vi.mock('../../../people/staff/use-staff', () => ({
  useStaff: () => ({ staff: [], loading: false }),
}));
vi.mock('../../../people/guardians/use-guardians', () => ({
  useGuardians: () => ({ data: undefined, loading: false }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import NewGroupPage from '../page';

describe('NewGroupPage (ROV-358)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGroup.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [{ message: 'raw server text', extensions: { code: 'GROUP_NAME_DUPLICATE' } }],
      }),
    );
  });

  it('takes the user back to the name and shows that it is taken', async () => {
    renderWithProviders(<NewGroupPage />);
    const name = screen.getByRole('textbox', { name: 'Group name' });
    await userEvent.type(name, 'Eco Club');
    await userEvent.click(screen.getByRole('combobox', { name: 'Group type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Club' }));
    await userEvent.click(screen.getByTestId(ids.newNextBtn));

    await userEvent.click(await screen.findByRole('button', { name: /create/i }));

    expect(await screen.findByText(errorEn.GROUP_NAME_DUPLICATE)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Group name' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByText('raw server text')).toBeNull();
  });
});
