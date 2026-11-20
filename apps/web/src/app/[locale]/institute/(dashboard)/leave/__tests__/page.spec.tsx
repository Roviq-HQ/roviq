/**
 * Component tests for the Leaves list page.
 *
 * Mocks `next/navigation`, `nuqs`, `@roviq/auth`, the locale-aware `Link`, the
 * feature's `use-leave` hook module, and the shared students hook.
 */
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';

// cmdk scrolls the active option into view; happy-dom does not ship it.
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/leave',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

// The shared setup stubs the locale-aware Link to render nothing; this page's Apply link is under test.
vi.mock('@roviq/i18n', async () => {
  const actual = await vi.importActual<typeof import('@roviq/i18n')>('@roviq/i18n');
  return {
    ...actual,
    Link: ({ href, children, ...rest }: ComponentProps<'a'>) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
});

const querySetters = vi.hoisted(() => new Map<string, (value: string | null) => Promise<null>>());
const queryValues = vi.hoisted(() => new Map<string, string>());
// Real state behind each query key, so a filter change re-renders like nuqs does.
vi.mock('nuqs', async () => {
  const { useState } = await import('react');
  return {
    parseAsString: {
      withDefault: (defaultValue: string) => ({ __kind: 'string', defaultValue }),
    },
    parseAsInteger: {
      withDefault: (defaultValue: number) => ({ __kind: 'integer', defaultValue }),
    },
    useQueryState: (key: string, parser?: { defaultValue?: unknown }) => {
      let spy = querySetters.get(key);
      if (!spy) {
        spy = vi.fn().mockResolvedValue(null);
        querySetters.set(key, spy);
      }
      const record = spy;
      const fallback = parser && 'defaultValue' in parser ? (parser.defaultValue as unknown) : null;
      const [value, setValue] = useState<unknown>(queryValues.get(key) ?? fallback);
      const setter = (next: string | null) => {
        setValue(next);
        return record(next);
      };
      return [value, setter];
    },
  };
});

const OWN_MEMBERSHIP_ID = '018f3e2c-0000-7000-8000-0000000000aa';
vi.mock('@roviq/auth', () => ({
  useAuth: () => ({ user: { membershipId: OWN_MEMBERSHIP_ID } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// The student profile id and the membership id differ on purpose: a leave belongs to the
// membership, so only the membership id may reach the filter.
const SECTION_ID = '018f3e2c-0000-7000-8000-000000000501';
const STUDENT = {
  id: '018f3e2c-0000-7000-8000-000000000701',
  membershipId: '018f3e2c-0000-7000-8000-000000000404',
  admissionNumber: 'S-2026/0001',
  firstName: { en: 'Priya' },
  lastName: { en: 'Singh' },
  currentSectionId: SECTION_ID,
  currentStandardId: '018f3e2c-0000-7000-8000-000000000601',
};

vi.mock('../../people/students/use-students', () => ({
  useStudents: () => ({
    students: [STUDENT],
    totalCount: 1,
    hasNextPage: false,
    loading: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
  }),
}));

interface LeaveFixture {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: 'MEDICAL' | 'CASUAL' | 'BEREAVEMENT' | 'EXAM' | 'OTHER';
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  files: {
    id: string;
    name: string;
    contentType: string;
    sizeBytes: number;
    url: string | null;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
    placeholder: string | null;
  }[];
  decidedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const hookState: { leaves: LeaveFixture[]; error: Error | undefined } = {
  leaves: [],
  error: undefined,
};
const useLeavesMock = vi.fn();
const refetchMock = vi.fn();
const approveMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('../use-leave', () => ({
  LEAVE_STATUS_VALUES: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const,
  LEAVE_TYPE_VALUES: ['MEDICAL', 'CASUAL', 'BEREAVEMENT', 'EXAM', 'OTHER'] as const,
  useLeaves: (filter: unknown) => {
    useLeavesMock(filter);
    return {
      leaves: hookState.leaves,
      loading: false,
      error: hookState.error,
      refetch: refetchMock,
    };
  },
  useApproveLeave: () => ({ approve: approveMock, loading: false }),
  useRejectLeave: () => ({ reject: vi.fn(), loading: false }),
  useCancelLeave: () => ({ cancel: cancelMock, loading: false }),
  useApplyLeave: () => ({ apply: vi.fn(), loading: false }),
  useUpdateLeave: () => ({ update: vi.fn(), loading: false }),
  useDeleteLeave: () => ({ remove: vi.fn(), loading: false }),
  useLeave: () => ({ leave: null, loading: false, error: undefined, refetch: vi.fn() }),
}));

// Import AFTER mocks so they apply.
import LeavesPage from '../page';

function pendingLeave(overrides: Partial<LeaveFixture> = {}): LeaveFixture {
  return {
    id: 'leave-1',
    userId: STUDENT.membershipId,
    startDate: '2026-04-10',
    endDate: '2026-04-11',
    type: 'CASUAL',
    reason: 'Family function',
    status: 'PENDING',
    files: [],
    decidedBy: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

// As the server sends them: `$user.*` placeholders already substituted.
const OWN_LEAVE_RULES = [
  { action: 'read', subject: 'Leave', conditions: { userId: OWN_MEMBERSHIP_ID } },
  { action: 'create', subject: 'Leave', conditions: { userId: OWN_MEMBERSHIP_ID } },
  {
    action: 'withdraw',
    subject: 'Leave',
    conditions: { userId: OWN_MEMBERSHIP_ID, status: 'PENDING' },
  },
] as const;

// A class teacher decides leaves of their section's students and files their own.
const CLASS_TEACHER_RULES = [
  { action: 'manage', subject: 'Leave', conditions: { sectionId: { $in: [SECTION_ID] } } },
  { action: 'create', subject: 'Leave', conditions: { userId: OWN_MEMBERSHIP_ID } },
  { action: 'read', subject: 'Leave', conditions: { userId: OWN_MEMBERSHIP_ID } },
  {
    action: 'withdraw',
    subject: 'Leave',
    conditions: { userId: OWN_MEMBERSHIP_ID, status: 'PENDING' },
  },
] as const;

const GUARDIAN_RULES = [
  { action: 'read', subject: 'Student', conditions: { id: { $in: [STUDENT.id] } } },
  { action: 'read', subject: 'Leave', conditions: { studentProfileId: { $in: [STUDENT.id] } } },
  { action: 'create', subject: 'Leave', conditions: { studentProfileId: { $in: [STUDENT.id] } } },
  {
    action: 'withdraw',
    subject: 'Leave',
    conditions: { studentProfileId: { $in: [STUDENT.id] }, status: 'PENDING' },
  },
] as const;

describe('LeavesPage', () => {
  beforeEach(() => {
    approveMock.mockReset();
    cancelMock.mockReset();
    refetchMock.mockReset();
    useLeavesMock.mockReset();
    querySetters.clear();
    queryValues.clear();
    hookState.error = undefined;
  });

  it('renders title + tabs and the empty-state copy when there are no leaves', () => {
    hookState.leaves = [];
    renderWithProviders(<LeavesPage />);
    expect(screen.getByTestId('leave-title')).toBeInTheDocument();
    expect(screen.getByTestId('leave-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('leave-tab-all')).toBeInTheDocument();
    expect(screen.getByTestId('leave-tab-pending')).toBeInTheDocument();
    expect(screen.getByText('No leave applications found.')).toBeInTheDocument();
  });

  it('renders a row per leave with the right status badge text', () => {
    hookState.leaves = [
      {
        id: 'leave-1',
        userId: 'stu-1',
        startDate: '2026-04-10',
        endDate: '2026-04-11',
        type: 'CASUAL',
        reason: 'Family function',
        status: 'PENDING',
        files: [],
        decidedBy: null,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
      {
        id: 'leave-2',
        userId: 'stu-2',
        startDate: '2026-04-12',
        endDate: '2026-04-13',
        type: 'MEDICAL',
        reason: 'Sick leave',
        status: 'APPROVED',
        files: [],
        decidedBy: 'mem-1',
        createdAt: '2026-04-02T00:00:00Z',
        updatedAt: '2026-04-02T00:00:00Z',
      },
    ];
    renderWithProviders(<LeavesPage />);
    expect(screen.getByTestId('leave-row-leave-1-status')).toHaveTextContent('Pending');
    expect(screen.getByTestId('leave-row-leave-2-status')).toHaveTextContent('Approved');
    expect(screen.getByTestId('leave-row-leave-1-type')).toHaveTextContent('Casual');
    expect(screen.getByTestId('leave-row-leave-2-type')).toHaveTextContent('Medical');
  });

  it('hides the page and shows access-denied copy when ability denies read on Leave', () => {
    hookState.leaves = [];
    renderWithProviders(<LeavesPage />, {
      abilityRules: [
        { action: 'manage', subject: 'all' },
        { action: 'read', subject: 'Leave', inverted: true },
      ],
    });
    expect(screen.getByTestId('leave-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('leave-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leave-tabs')).not.toBeInTheDocument();
  });

  it('filters by the picked student membership id, not the student profile id', async () => {
    hookState.leaves = [];
    const user = userEvent.setup();
    renderWithProviders(<LeavesPage />);

    await user.click(screen.getByTestId('leave-user-picker'));
    await user.click(await screen.findByTestId(`leave-user-picker-option-${STUDENT.membershipId}`));

    expect(querySetters.get('userId')).toHaveBeenCalledWith(STUDENT.membershipId);
  });

  it('names the applicant from the student list by membership id', () => {
    hookState.leaves = [pendingLeave()];
    renderWithProviders(<LeavesPage />);
    expect(screen.getByTestId('leave-row-leave-1-applicant')).toHaveTextContent(
      'Priya Singh · S-2026/0001',
    );
  });

  it('confirms an approval with a translated message, not the button label', async () => {
    hookState.leaves = [pendingLeave()];
    approveMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithProviders(<LeavesPage />);

    await user.click(screen.getByTestId('leave-row-leave-1-approve-btn'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Leave approved.'));
    expect(approveMock).toHaveBeenCalledWith('leave-1');
  });

  it('shows translated copy chosen by error code when an approval is refused', async () => {
    hookState.leaves = [pendingLeave()];
    approveMock.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [{ message: 'You may not change this leave.', extensions: { code: 'FORBIDDEN' } }],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<LeavesPage />);

    await user.click(screen.getByTestId('leave-row-leave-1-approve-btn'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('You are not allowed to change this leave.'),
    );
  });

  describe('withdraw', () => {
    it('offers Withdraw on an own pending leave and nothing on an own approved one', () => {
      hookState.leaves = [
        pendingLeave({ id: 'own-pending', userId: OWN_MEMBERSHIP_ID }),
        pendingLeave({ id: 'own-approved', userId: OWN_MEMBERSHIP_ID, status: 'APPROVED' }),
      ];
      renderWithProviders(<LeavesPage />, { abilityRules: [...OWN_LEAVE_RULES] });

      expect(screen.getByTestId('leave-row-own-pending-withdraw-btn')).toHaveAttribute(
        'title',
        'Withdraw',
      );
      expect(screen.queryByTestId('leave-row-own-approved-withdraw-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-row-own-approved-cancel-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-row-own-pending-cancel-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-row-own-pending-approve-btn')).not.toBeInTheDocument();
    });

    it('offers no Withdraw on someone else’s pending leave', () => {
      hookState.leaves = [pendingLeave({ id: 'other-pending', userId: STUDENT.membershipId })];
      renderWithProviders(<LeavesPage />, { abilityRules: [...OWN_LEAVE_RULES] });

      expect(screen.queryByTestId('leave-row-other-pending-withdraw-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-row-other-pending-cancel-btn')).not.toBeInTheDocument();
    });

    it('withdraws only after the confirmation, then says so', async () => {
      hookState.leaves = [pendingLeave({ id: 'own-pending', userId: OWN_MEMBERSHIP_ID })];
      cancelMock.mockResolvedValue({});
      const user = userEvent.setup();
      renderWithProviders(<LeavesPage />, { abilityRules: [...OWN_LEAVE_RULES] });

      await user.click(screen.getByTestId('leave-row-own-pending-withdraw-btn'));
      expect(await screen.findByTestId('leave-withdraw-dialog')).toHaveTextContent(
        'Withdraw this leave?',
      );
      expect(cancelMock).not.toHaveBeenCalled();

      await user.click(screen.getByTestId('leave-withdraw-confirm-btn'));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Leave withdrawn.'));
      expect(cancelMock).toHaveBeenCalledWith('own-pending');
    });

    it('does nothing when the confirmation is dismissed', async () => {
      hookState.leaves = [pendingLeave({ id: 'own-pending', userId: OWN_MEMBERSHIP_ID })];
      const user = userEvent.setup();
      renderWithProviders(<LeavesPage />, { abilityRules: [...OWN_LEAVE_RULES] });

      await user.click(screen.getByTestId('leave-row-own-pending-withdraw-btn'));
      await user.click(await screen.findByTestId('leave-withdraw-dismiss-btn'));

      await waitFor(() =>
        expect(screen.queryByTestId('leave-withdraw-dialog')).not.toBeInTheDocument(),
      );
      expect(cancelMock).not.toHaveBeenCalled();
    });

    it('shows the translated refusal when the server forbids the withdrawal', async () => {
      hookState.leaves = [pendingLeave({ id: 'own-pending', userId: OWN_MEMBERSHIP_ID })];
      cancelMock.mockRejectedValue(
        new CombinedGraphQLErrors({
          errors: [{ message: 'raw server text', extensions: { code: 'FORBIDDEN' } }],
        }),
      );
      const user = userEvent.setup();
      renderWithProviders(<LeavesPage />, { abilityRules: [...OWN_LEAVE_RULES] });

      await user.click(screen.getByTestId('leave-row-own-pending-withdraw-btn'));
      await user.click(await screen.findByTestId('leave-withdraw-confirm-btn'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('You are not allowed to change this leave.'),
      );
    });

    it('keeps Cancel, without a confirmation, for approvers', async () => {
      hookState.leaves = [pendingLeave({ status: 'APPROVED' })];
      cancelMock.mockResolvedValue({});
      const user = userEvent.setup();
      renderWithProviders(<LeavesPage />);

      expect(screen.queryByTestId('leave-row-leave-1-withdraw-btn')).not.toBeInTheDocument();
      const cancel = screen.getByTestId('leave-row-leave-1-cancel-btn');
      expect(cancel).toHaveAttribute('title', 'Cancel');
      await user.click(cancel);

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Leave cancelled.'));
      expect(cancelMock).toHaveBeenCalledWith('leave-1');
    });
  });

  describe('guardian', () => {
    it('shows the Apply link and names the child on each leave', () => {
      hookState.leaves = [pendingLeave()];
      renderWithProviders(<LeavesPage />, { abilityRules: [...GUARDIAN_RULES] });

      expect(screen.getByTestId('leave-apply-link')).toHaveAttribute('href', '/leave/apply');
      expect(screen.getByTestId('leave-row-leave-1-applicant')).toHaveTextContent(
        'Priya Singh · S-2026/0001',
      );
    });

    it('offers Withdraw on a child’s pending leave but not on an approved one', () => {
      hookState.leaves = [
        pendingLeave({ id: 'child-pending' }),
        pendingLeave({ id: 'child-approved', status: 'APPROVED' }),
      ];
      renderWithProviders(<LeavesPage />, { abilityRules: [...GUARDIAN_RULES] });

      expect(screen.getByTestId('leave-row-child-pending-withdraw-btn')).toBeInTheDocument();
      expect(screen.queryByTestId('leave-row-child-approved-withdraw-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-row-child-pending-approve-btn')).not.toBeInTheDocument();
    });

    it('offers no Withdraw on a leave of a student who is not their child', () => {
      hookState.leaves = [pendingLeave({ id: 'stranger', userId: OWN_MEMBERSHIP_ID })];
      renderWithProviders(<LeavesPage />, { abilityRules: [...GUARDIAN_RULES] });

      expect(screen.queryByTestId('leave-row-stranger-withdraw-btn')).not.toBeInTheDocument();
    });
  });

  describe('class teacher', () => {
    it('offers Withdraw, with a confirmation, and no decision on an own pending leave', async () => {
      hookState.leaves = [pendingLeave({ id: 'own-pending', userId: OWN_MEMBERSHIP_ID })];
      const user = userEvent.setup();
      renderWithProviders(<LeavesPage />, { abilityRules: [...CLASS_TEACHER_RULES] });

      expect(screen.queryByTestId('leave-row-own-pending-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-row-own-pending-reject-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-row-own-pending-cancel-btn')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('leave-row-own-pending-withdraw-btn'));
      expect(await screen.findByTestId('leave-withdraw-dialog')).toBeInTheDocument();
      expect(cancelMock).not.toHaveBeenCalled();
    });

    it('offers no action on an own approved leave', () => {
      hookState.leaves = [
        pendingLeave({ id: 'own-approved', userId: OWN_MEMBERSHIP_ID, status: 'APPROVED' }),
      ];
      renderWithProviders(<LeavesPage />, { abilityRules: [...CLASS_TEACHER_RULES] });

      expect(screen.queryByTestId('leave-row-own-approved-cancel-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-row-own-approved-withdraw-btn')).not.toBeInTheDocument();
    });

    it('offers Approve, Reject and Cancel on a section student’s pending leave', () => {
      hookState.leaves = [pendingLeave({ id: 'section-pending' })];
      renderWithProviders(<LeavesPage />, { abilityRules: [...CLASS_TEACHER_RULES] });

      expect(screen.getByTestId('leave-row-section-pending-approve-btn')).toBeInTheDocument();
      expect(screen.getByTestId('leave-row-section-pending-reject-btn')).toBeInTheDocument();
      expect(screen.getByTestId('leave-row-section-pending-cancel-btn')).toBeInTheDocument();
      expect(
        screen.queryByTestId('leave-row-section-pending-withdraw-btn'),
      ).not.toBeInTheDocument();
    });

    it('shows the pending tab and the applicant filter', () => {
      hookState.leaves = [];
      renderWithProviders(<LeavesPage />, { abilityRules: [...CLASS_TEACHER_RULES] });

      expect(screen.getByTestId('leave-tab-pending')).toBeInTheDocument();
      expect(screen.getByTestId('leave-user-picker')).toBeInTheDocument();
    });
  });

  describe('tabs and filters by ability', () => {
    it('shows a student the list without a tab bar or an applicant filter', () => {
      hookState.leaves = [];
      renderWithProviders(<LeavesPage />, { abilityRules: [...OWN_LEAVE_RULES] });

      expect(screen.queryByTestId('leave-tabs')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-tab-pending')).not.toBeInTheDocument();
      expect(screen.getByTestId('leave-filter-type')).toBeInTheDocument();
      expect(screen.getByText('No leave applications found.')).toBeInTheDocument();
      expect(screen.queryByTestId('leave-user-picker')).not.toBeInTheDocument();
    });

    it('shows a guardian the list without a tab bar or an applicant filter', () => {
      hookState.leaves = [];
      renderWithProviders(<LeavesPage />, { abilityRules: [...GUARDIAN_RULES] });

      expect(screen.queryByTestId('leave-tabs')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-tab-pending')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-user-picker')).not.toBeInTheDocument();
    });

    it('lists all leaves to a student whose URL still asks for the pending tab', () => {
      queryValues.set('tab', 'pending');
      hookState.leaves = [pendingLeave({ id: 'own', userId: OWN_MEMBERSHIP_ID })];
      renderWithProviders(<LeavesPage />, { abilityRules: [...OWN_LEAVE_RULES] });

      expect(screen.getByTestId('leave-row-own-status')).toHaveTextContent('Pending');
    });

    it('applies the applicant, type and date filters on the pending tab', () => {
      queryValues.set('tab', 'pending');
      queryValues.set('userId', STUDENT.membershipId);
      queryValues.set('type', 'MEDICAL');
      queryValues.set('startDate', '2030-01-01');
      queryValues.set('endDate', '2030-01-31');
      hookState.leaves = [];
      renderWithProviders(<LeavesPage />);

      expect(useLeavesMock).toHaveBeenCalledWith({
        userId: STUDENT.membershipId,
        status: 'PENDING',
        type: 'MEDICAL',
        startDate: '2030-01-01',
        endDate: '2030-01-31',
      });
    });
  });

  describe('load failure', () => {
    it('shows an error with a retry instead of the empty state', async () => {
      hookState.leaves = [];
      hookState.error = new Error('network down');
      const user = userEvent.setup();
      renderWithProviders(<LeavesPage />);

      expect(screen.getByTestId('leave-list-error')).toHaveTextContent(
        'Leaves could not be loaded.',
      );
      expect(screen.queryByText('No leave applications found.')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('leave-list-retry-btn'));
      expect(refetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('pending tab filters', () => {
    it('shows every filter except status on the pending tab', () => {
      queryValues.set('tab', 'pending');
      hookState.leaves = [];
      renderWithProviders(<LeavesPage />);

      expect(screen.getByTestId('leave-user-picker')).toBeInTheDocument();
      expect(screen.getByTestId('leave-filter-type')).toBeInTheDocument();
      expect(screen.getByTestId('leave-filter-start-date')).toBeInTheDocument();
      expect(screen.getByTestId('leave-filter-end-date')).toBeInTheDocument();
      expect(screen.queryByTestId('leave-filter-status')).not.toBeInTheDocument();
    });

    it('narrows the pending list when a date filter changes there', () => {
      queryValues.set('tab', 'pending');
      hookState.leaves = [];
      renderWithProviders(<LeavesPage />);

      fireEvent.change(screen.getByTestId('leave-filter-start-date'), {
        target: { value: '2030-01-05' },
      });

      expect(querySetters.get('startDate')).toHaveBeenCalledWith('2030-01-05');
      expect(useLeavesMock).toHaveBeenLastCalledWith({
        userId: null,
        status: 'PENDING',
        type: null,
        startDate: '2030-01-05',
        endDate: null,
      });
    });

    it('keeps the applicant filter on the pending tab for a class teacher', () => {
      queryValues.set('tab', 'pending');
      hookState.leaves = [];
      renderWithProviders(<LeavesPage />, { abilityRules: [...CLASS_TEACHER_RULES] });

      expect(screen.getByTestId('leave-user-picker')).toBeInTheDocument();
      expect(screen.queryByTestId('leave-filter-status')).not.toBeInTheDocument();
    });
  });

  describe('dates in the URL', () => {
    it.each([
      ['startDate', 'garbage'],
      ['endDate', '2030-13-01'],
      ['startDate', '2030-02-30'],
    ])('drops an invalid %s of %j and loads the list without it', (key, value) => {
      queryValues.set(key, value);
      hookState.leaves = [];
      renderWithProviders(<LeavesPage />);

      expect(querySetters.get(key)).toHaveBeenCalledWith(null);
      expect(useLeavesMock).toHaveBeenLastCalledWith({
        userId: null,
        status: null,
        type: null,
        startDate: null,
        endDate: null,
      });
      expect(screen.getByText('No leave applications found.')).toBeInTheDocument();
    });

    it('keeps a valid URL date and shows it in its input', () => {
      queryValues.set('endDate', '2030-01-31');
      hookState.leaves = [];
      renderWithProviders(<LeavesPage />);

      expect(querySetters.get('endDate')).not.toHaveBeenCalled();
      expect(screen.getByTestId('leave-filter-end-date')).toHaveValue('2030-01-31');
      expect(useLeavesMock).toHaveBeenLastCalledWith({
        userId: null,
        status: null,
        type: null,
        startDate: null,
        endDate: '2030-01-31',
      });
    });
  });
});
