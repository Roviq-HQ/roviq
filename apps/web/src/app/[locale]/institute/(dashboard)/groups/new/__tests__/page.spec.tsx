import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ACADEMIC_STATUS_VALUES, GROUP_RULE_DIMENSION_VALUES } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import errorEn from '../../../../../../../../messages/en/error.json';
import groupsEn from '../../../../../../../../messages/en/groups.json';
import studentsEn from '../../../../../../../../messages/en/students.json';
import groupsHi from '../../../../../../../../messages/hi/groups.json';
import studentsHi from '../../../../../../../../messages/hi/students.json';

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

vi.mock('../../../academics/use-academics', () => ({
  useStandards: () => ({
    standards: [
      { id: 'standard-6', name: { en: 'Class 6' } },
      { id: 'standard-7', name: { en: 'Class 7' } },
    ],
  }),
  useSections: () => ({ sections: [] }),
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

  const pickValue = async (label: string) => {
    await userEvent.click(screen.getByTestId(ids.newRuleValue));
    await userEvent.click(await screen.findByRole('option', { name: label }));
  };

  const ruleSent = () => {
    expect(mocks.createGroup).toHaveBeenCalledTimes(1);
    return mocks.createGroup.mock.calls[0]?.[0].variables.input.rule;
  };

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
    await pickValue(studentsEn.academicStatuses.PROMOTED);
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(ruleSent()).toEqual({ and: [{ '==': [{ var: 'academic_status' }, 'PROMOTED'] }] });
  });

  it('should offer the translated statuses as the value of a student status rule', async () => {
    renderWithProviders(<NewGroupPage />, { locale: 'hi' });
    await openRuleStep(groupsHi);
    await userEvent.click(
      await screen.findByRole('option', { name: groupsHi.dimensions.academic_status }),
    );
    await userEvent.click(screen.getByTestId(ids.newRuleValue));

    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(
      ACADEMIC_STATUS_VALUES.map((v) => studentsHi.academicStatuses[v]),
    );
  });

  it('should offer Yes and No for a yes-or-no dimension and send a boolean', async () => {
    renderWithProviders(<NewGroupPage />);
    await openRuleStep(groupsEn);
    await userEvent.click(
      await screen.findByRole('option', { name: groupsEn.dimensions.is_rte_admitted }),
    );
    await userEvent.click(screen.getByTestId(ids.newRuleValue));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      groupsEn.ruleValues.boolean.true,
      groupsEn.ruleValues.boolean.false,
    ]);
    await userEvent.click(screen.getByRole('option', { name: groupsEn.ruleValues.boolean.true }));
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(ruleSent()).toEqual({ and: [{ '==': [{ var: 'is_rte_admitted' }, true] }] });
  });

  it('should offer the streams with their labels', async () => {
    renderWithProviders(<NewGroupPage />);
    await openRuleStep(groupsEn);
    await userEvent.click(await screen.findByRole('option', { name: groupsEn.dimensions.stream }));
    await pickValue(groupsEn.ruleValues.stream.SCIENCE_PCB);
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(ruleSent()).toEqual({ and: [{ '==': [{ var: 'stream' }, 'SCIENCE_PCB'] }] });
  });

  it("should offer the institute's classes for a standard rule", async () => {
    renderWithProviders(<NewGroupPage />);
    await openRuleStep(groupsEn);
    await userEvent.click(
      await screen.findByRole('option', { name: groupsEn.dimensions.standard_id }),
    );
    await pickValue('Class 7');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(ruleSent()).toEqual({ and: [{ '==': [{ var: 'standard_id' }, 'standard-7'] }] });
  });

  it('should keep a text box for a dimension without a fixed set of values', async () => {
    renderWithProviders(<NewGroupPage />);
    await openRuleStep(groupsEn);
    await userEvent.click(
      await screen.findByRole('option', { name: groupsEn.dimensions.religion }),
    );
    await userEvent.type(screen.getByRole('textbox', { name: groupsEn.new.rule.value }), 'Sikh');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(ruleSent()).toEqual({ and: [{ '==': [{ var: 'religion' }, 'Sikh'] }] });
  });

  it('should clear the value when the dimension changes', async () => {
    renderWithProviders(<NewGroupPage />);
    await openRuleStep(groupsEn);
    await userEvent.click(
      await screen.findByRole('option', { name: groupsEn.dimensions.religion }),
    );
    await userEvent.type(screen.getByRole('textbox', { name: groupsEn.new.rule.value }), 'Sikh');
    await userEvent.click(screen.getByTestId(ids.newRuleDimension));
    await userEvent.click(
      await screen.findByRole('option', { name: groupsEn.dimensions.mother_tongue }),
    );

    expect(screen.getByRole('textbox', { name: groupsEn.new.rule.value })).toHaveValue('');
  });
});
