import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { Locale } from '@roviq/i18n';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import errorEn from '../../../../../../../../messages/en/error.json';
import groupsEn from '../../../../../../../../messages/en/groups.json';
import groupsHi from '../../../../../../../../messages/hi/groups.json';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

const { instituteGroups: ids, form: formIds } = testIds;

const createGroupMock = vi.fn();
const runPreviewMock = vi.fn();

vi.mock('../../use-groups', () => ({
  useCreateGroup: () => [createGroupMock, { loading: false }],
  usePreviewGroupRule: () => [runPreviewMock, { loading: false }],
}));

const STUDENT = {
  id: 'stu-profile-1',
  membershipId: 'stu-membership-1',
  firstName: { en: 'Asha' },
  lastName: { en: 'Verma' },
  admissionNumber: 'ADM-1',
};
const STAFF = {
  id: 'staff-profile-1',
  membershipId: 'staff-membership-1',
  firstName: { en: 'Ravi' },
  lastName: { en: 'Nair' },
  employeeId: 'EMP-1',
};

vi.mock('../../../people/students/use-students', () => ({
  useStudents: () => ({ students: [STUDENT], loading: false }),
}));
vi.mock('../../../people/staff/use-staff', () => ({
  useStaff: () => ({ staff: [STAFF], loading: false }),
}));
vi.mock('../../../people/guardians/use-guardians', () => ({
  useGuardians: () => ({ data: { listGuardians: [] }, loading: false }),
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
  toast: { success: vi.fn(), error: vi.fn() },
}));

import NewGroupPage from '../page';

type Messages = typeof groupsEn;

const graphQLError = (code: string) =>
  new CombinedGraphQLErrors({ errors: [{ message: 'raw server text', extensions: { code } }] });

function renderPage(locale: Locale = 'en') {
  renderWithProviders(<NewGroupPage />, { locale });
  return locale === 'hi' ? groupsHi : groupsEn;
}

async function pick(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(label) }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(`^${option}`) }));
}

/** Fills the Basics step and moves to the Rule step. */
async function toRuleStep(m: Messages, membership: 'DYNAMIC' | 'HYBRID') {
  await userEvent.type(
    screen.getByRole('textbox', { name: new RegExp(m.new.basics.name) }),
    'Science Club',
  );
  await pick(m.new.basics.type, m.types.CLUB);
  await pick(m.new.basics.membershipType, m.membershipTypes[membership]);
  await userEvent.click(screen.getByTestId(ids.newNextBtn));
  await screen.findByText(m.new.rule.sectionTitle);
}

/** Fills Basics for a static group of students and staff and moves to the Members step. */
async function toMembersStep(m: Messages) {
  await userEvent.type(
    screen.getByRole('textbox', { name: new RegExp(m.new.basics.name) }),
    'Science Club',
  );
  await pick(m.new.basics.type, m.types.CLUB);
  await userEvent.click(screen.getByRole('checkbox', { name: m.memberTypes.staff }));
  await userEvent.click(screen.getByTestId(ids.newNextBtn));
  await screen.findByText(m.new.members.sectionTitle);
}

async function addCandidate(m: Messages, label: string) {
  const row = screen.getAllByRole('listitem').find((li) => within(li).queryByText(label));
  if (!row) throw new Error(`no candidate row for ${label}`);
  await userEvent.click(within(row).getByRole('button', { name: m.new.members.addMember }));
}

async function fillCondition(m: Messages) {
  await userEvent.type(screen.getByRole('textbox', { name: m.new.rule.value }), 'female');
}

const submitAlert = () => screen.getByTestId(formIds.submitError);

function expectAlert(copy: { title: string; description: string }) {
  const alert = submitAlert();
  expect(alert).toHaveAttribute('role', 'alert');
  expect(within(alert).getByText(copy.title)).toBeInTheDocument();
  expect(within(alert).getByText(copy.description)).toBeInTheDocument();
}

describe('NewGroupPage submit errors', () => {
  beforeEach(() => {
    createGroupMock.mockReset();
    runPreviewMock.mockReset();
    pushMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('should show the empty-rule alert and move to the Rule step instead of creating', async () => {
    const m = renderPage();
    await toRuleStep(m, 'HYBRID');
    await userEvent.click(screen.getByTestId(ids.newNextBtn));
    await screen.findByText(m.new.members.sectionTitle);

    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));

    await screen.findByTestId(formIds.submitError);
    expectAlert({ title: m.new.ruleEmpty.title, description: m.new.ruleEmpty.submitDescription });
    expect(screen.getByText(m.new.rule.sectionTitle)).toBeInTheDocument();
    expect(screen.queryByText(m.new.members.sectionTitle)).not.toBeInTheDocument();
    expect(createGroupMock).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should show the permission copy in the form and keep Create enabled when FORBIDDEN', async () => {
    createGroupMock.mockRejectedValue(graphQLError('FORBIDDEN'));
    const m = renderPage();
    await toRuleStep(m, 'DYNAMIC');
    await fillCondition(m);

    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));

    await screen.findByTestId(formIds.submitError);
    expectAlert(m.new.submitErrors.forbidden);
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId(ids.newSubmitBtn)).toBeEnabled());
  });

  it('should show a taken name under the Name field and return to Basics', async () => {
    createGroupMock.mockRejectedValue(graphQLError('GROUP_NAME_DUPLICATE'));
    const m = renderPage();
    await toRuleStep(m, 'DYNAMIC');
    await fillCondition(m);

    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));

    expect(await screen.findByText(errorEn.GROUP_NAME_DUPLICATE)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: new RegExp(m.new.basics.name) })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.queryByText(m.new.rule.sectionTitle)).not.toBeInTheDocument();
    expect(screen.queryByTestId(formIds.submitError)).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should show the connection copy when the server cannot be reached', async () => {
    createGroupMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const m = renderPage();
    await toRuleStep(m, 'DYNAMIC');
    await fillCondition(m);

    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));

    await screen.findByTestId(formIds.submitError);
    expectAlert(m.new.submitErrors.network);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should show the connection copy in Hindi', async () => {
    createGroupMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const m = renderPage('hi');
    await toRuleStep(m, 'DYNAMIC');
    await fillCondition(m);

    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));

    await screen.findByTestId(formIds.submitError);
    expectAlert(groupsHi.new.submitErrors.network);
  });

  it('should clear the alert and create the group when Create is pressed again', async () => {
    createGroupMock
      .mockRejectedValueOnce(graphQLError('INTERNAL_ERROR'))
      .mockResolvedValueOnce({ data: { createGroup: { id: 'grp-1' } } });
    const m = renderPage();
    await toRuleStep(m, 'DYNAMIC');
    await fillCondition(m);
    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));
    await screen.findByTestId(formIds.submitError);
    expectAlert(m.new.submitErrors.unknown);

    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/institute/groups/grp-1'));
    expect(screen.queryByTestId(formIds.submitError)).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith(m.new.createSuccess);
    expect(createGroupMock).toHaveBeenCalledTimes(2);
    expect(createGroupMock).toHaveBeenLastCalledWith({
      variables: {
        input: {
          name: 'Science Club',
          groupType: 'CLUB',
          membershipType: 'DYNAMIC',
          memberTypes: ['student'],
          rule: { and: [{ '==': [{ var: 'gender' }, 'female'] }] },
        },
      },
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should show the unknown copy when the server returns no group', async () => {
    createGroupMock.mockResolvedValue({ data: null });
    const m = renderPage();
    await toRuleStep(m, 'DYNAMIC');
    await fillCondition(m);

    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));

    await screen.findByTestId(formIds.submitError);
    expectAlert(m.new.submitErrors.unknown);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('NewGroupPage members', () => {
  beforeEach(() => {
    createGroupMock.mockReset();
    pushMock.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('should send the membership ids of the picked people', async () => {
    createGroupMock.mockResolvedValue({ data: { createGroup: { id: 'grp-2' } } });
    const m = renderPage();
    await toMembersStep(m);
    await addCandidate(m, 'Asha Verma · ADM-1');
    await addCandidate(m, 'Ravi Nair');

    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/institute/groups/grp-2'));
    expect(createGroupMock).toHaveBeenCalledWith({
      variables: {
        input: {
          name: 'Science Club',
          groupType: 'CLUB',
          membershipType: 'STATIC',
          memberTypes: ['student', 'staff'],
          rule: undefined,
          memberMembershipIds: ['stu-membership-1', 'staff-membership-1'],
        },
      },
    });
  });

  it('should show the member alert on the Members step when a member is refused', async () => {
    createGroupMock.mockRejectedValue(graphQLError('MEMBERSHIP_NOT_FOUND'));
    const m = renderPage();
    await toMembersStep(m);
    await addCandidate(m, 'Asha Verma · ADM-1');
    await userEvent.click(screen.getByTestId(ids.newSubmitBtn));

    await screen.findByTestId(formIds.submitError);
    expectAlert(m.new.submitErrors.memberNotFound);
    expect(screen.getByText(m.new.members.sectionTitle)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('NewGroupPage rule preview errors', () => {
  beforeEach(() => {
    runPreviewMock.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('should show the empty-rule message beside Preview and clear it when the rule changes', async () => {
    const m = renderPage();
    await toRuleStep(m, 'DYNAMIC');

    await userEvent.click(screen.getByTestId(ids.newRulePreviewBtn));

    const message = await screen.findByTestId(ids.newRulePreviewError);
    expect(message).toHaveAttribute('role', 'alert');
    expect(within(message).getByText(m.new.ruleEmpty.title)).toBeInTheDocument();
    expect(within(message).getByText(m.new.ruleEmpty.previewDescription)).toBeInTheDocument();
    expect(runPreviewMock).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    await fillCondition(m);

    expect(screen.queryByTestId(ids.newRulePreviewError)).not.toBeInTheDocument();
  });

  it('should show the permission copy beside Preview when the preview is refused', async () => {
    runPreviewMock.mockRejectedValue(graphQLError('FORBIDDEN'));
    const m = renderPage();
    await toRuleStep(m, 'DYNAMIC');
    await fillCondition(m);

    await userEvent.click(screen.getByTestId(ids.newRulePreviewBtn));

    const message = await screen.findByTestId(ids.newRulePreviewError);
    expect(within(message).getByText(m.new.previewErrors.forbidden.title)).toBeInTheDocument();
    expect(
      within(message).getByText(m.new.previewErrors.forbidden.description),
    ).toBeInTheDocument();
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
