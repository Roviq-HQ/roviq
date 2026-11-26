import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { GROUP_RULE_DIMENSION_VALUES } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import errorEn from '../../../../../../../../messages/en/error.json';
import groupsEn from '../../../../../../../../messages/en/groups.json';
import groupsHi from '../../../../../../../../messages/hi/groups.json';

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

describe('NewGroupPage rule builder dimensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGroup.mockResolvedValue({ data: { createGroup: { id: 'group-1' } } });
  });

  const openRuleStep = async (bundle: typeof groupsEn) => {
    const { basics } = bundle.new;
    await userEvent.type(screen.getByRole('textbox', { name: basics.name }), 'Promoted');
    await userEvent.click(screen.getByRole('combobox', { name: basics.type }));
    await userEvent.click(await screen.findByRole('option', { name: bundle.types.CLUB }));
    await userEvent.click(screen.getByRole('combobox', { name: basics.membershipType }));
    await userEvent.click(
      await screen.findByRole('option', { name: new RegExp(`^${bundle.membershipTypes.DYNAMIC}`) }),
    );
    await userEvent.click(screen.getByTestId(ids.newNextBtn));
    await userEvent.click(await screen.findByTestId(ids.newRuleDimension));
  };

  it('should offer every dimension the rule interpreter accepts, in English', async () => {
    renderWithProviders(<NewGroupPage />);
    await openRuleStep(groupsEn);

    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(GROUP_RULE_DIMENSION_VALUES.map((d) => groupsEn.dimensions[d]));
  });

  it('should offer every dimension with its Hindi label', async () => {
    renderWithProviders(<NewGroupPage />, { locale: 'hi' });
    await openRuleStep(groupsHi);

    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(GROUP_RULE_DIMENSION_VALUES.map((d) => groupsHi.dimensions[d]));
  });

  it('should create a group whose rule tests the student status', async () => {
    renderWithProviders(<NewGroupPage />);
    await openRuleStep(groupsEn);
    await userEvent.click(
      await screen.findByRole('option', { name: groupsEn.dimensions.academic_status }),
    );
    await userEvent.type(screen.getByTestId(ids.newRuleValue), 'PROMOTED');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(mocks.createGroup).toHaveBeenCalledTimes(1);
    expect(mocks.createGroup.mock.calls[0]?.[0].variables.input.rule).toEqual({
      and: [{ '==': [{ var: 'academic_status' }, 'PROMOTED'] }],
    });
  });
});
