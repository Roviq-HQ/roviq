/**
 * Component tests for the Leave detail page: load failures and action toasts.
 */
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en', id: 'leave-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/leave/leave-1',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const SECTION_ID = '018f3e2c-0000-7000-8000-000000000501';
const TEACHER_MEMBERSHIP_ID = '018f3e2c-0000-7000-8000-0000000000cc';
// A guardian's student list holds only their linked children; a class teacher's, their section.
const CHILD = {
  id: '018f3e2c-0000-7000-8000-000000000701',
  membershipId: '018f3e2c-0000-7000-8000-000000000404',
  admissionNumber: 'S-2026/0001',
  firstName: { en: 'Priya' },
  lastName: { en: 'Singh' },
  currentSectionId: SECTION_ID,
  currentStandardId: '018f3e2c-0000-7000-8000-000000000601',
};

vi.mock('../../../people/students/use-students', () => ({
  useStudents: () => ({
    students: [CHILD],
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
  type: 'MEDICAL';
  reason: string;
  status: 'PENDING' | 'APPROVED';
  files: never[];
  decidedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const PENDING_LEAVE: LeaveFixture = {
  id: 'leave-1',
  userId: CHILD.membershipId,
  startDate: '2026-04-10',
  endDate: '2026-04-10',
  type: 'MEDICAL',
  reason: 'Fever',
  status: 'PENDING',
  files: [],
  decidedBy: null,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
};

const state: { leave: LeaveFixture | null; error: Error | undefined } = {
  leave: null,
  error: undefined,
};
const refetchMock = vi.fn();
const rejectMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('../../use-leave', () => ({
  useLeave: () => ({
    leave: state.leave,
    loading: false,
    error: state.error,
    refetch: refetchMock,
  }),
  useApproveLeave: () => ({ approve: vi.fn(), loading: false }),
  useRejectLeave: () => ({ reject: rejectMock, loading: false }),
  useCancelLeave: () => ({ cancel: cancelMock, loading: false }),
}));

// Import AFTER mocks.
import LeaveDetailPage from '../page';

// As the server sends them: `$user.*` placeholders already substituted.
const APPLICANT_RULES = [
  { action: 'read', subject: 'Leave', conditions: { userId: CHILD.membershipId } },
  {
    action: 'withdraw',
    subject: 'Leave',
    conditions: { userId: CHILD.membershipId, status: 'PENDING' },
  },
] as const;

const CLASS_TEACHER_RULES = [
  { action: 'manage', subject: 'Leave', conditions: { sectionId: { $in: [SECTION_ID] } } },
  { action: 'create', subject: 'Leave', conditions: { userId: TEACHER_MEMBERSHIP_ID } },
  { action: 'read', subject: 'Leave', conditions: { userId: TEACHER_MEMBERSHIP_ID } },
  {
    action: 'withdraw',
    subject: 'Leave',
    conditions: { userId: TEACHER_MEMBERSHIP_ID, status: 'PENDING' },
  },
] as const;

const GUARDIAN_RULES = [
  { action: 'read', subject: 'Leave', conditions: { studentProfileId: { $in: [CHILD.id] } } },
  {
    action: 'withdraw',
    subject: 'Leave',
    conditions: { studentProfileId: { $in: [CHILD.id] }, status: 'PENDING' },
  },
] as const;

function graphQLError(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: 'raw server text', extensions: { code } }],
  });
}

describe('LeaveDetailPage', () => {
  beforeEach(() => {
    state.leave = null;
    state.error = undefined;
    refetchMock.mockReset().mockResolvedValue({});
    rejectMock.mockReset();
    cancelMock.mockReset();
  });

  it('shows a not-found state when the leave is missing or not readable', () => {
    state.error = graphQLError('LEAVE_NOT_FOUND');
    renderWithProviders(<LeaveDetailPage />);

    expect(screen.getByTestId('leave-detail-not-found')).toHaveTextContent('Leave not found');
    expect(screen.queryByTestId('leave-detail-retry-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leave-detail-card')).not.toBeInTheDocument();
  });

  it('offers a retry when loading fails for another reason', async () => {
    state.error = graphQLError('INTERNAL_ERROR');
    const user = userEvent.setup();
    renderWithProviders(<LeaveDetailPage />);

    expect(screen.getByTestId('leave-detail-error')).toHaveTextContent(
      'The leave could not be loaded.',
    );
    await user.click(screen.getByTestId('leave-detail-retry-btn'));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('confirms a rejection with a translated message, not the button label', async () => {
    state.leave = PENDING_LEAVE;
    rejectMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithProviders(<LeaveDetailPage />);

    await user.click(screen.getByTestId('leave-detail-reject-btn'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Leave rejected.'));
    expect(rejectMock).toHaveBeenCalledWith('leave-1');
  });

  it('shows translated copy chosen by error code when a cancel is refused', async () => {
    state.leave = PENDING_LEAVE;
    cancelMock.mockRejectedValue(graphQLError('INVALID_STATE_TRANSITION'));
    const user = userEvent.setup();
    renderWithProviders(<LeaveDetailPage />);

    await user.click(screen.getByTestId('leave-detail-cancel-btn'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This leave has already been decided or cancelled. Refresh to see its current status.',
      ),
    );
    expect(toast.error).not.toHaveBeenCalledWith('raw server text');
  });

  it('lets an applicant withdraw their own pending leave after confirming', async () => {
    state.leave = PENDING_LEAVE;
    cancelMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithProviders(<LeaveDetailPage />, { abilityRules: [...APPLICANT_RULES] });

    expect(screen.queryByTestId('leave-detail-cancel-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leave-detail-approve-btn')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('leave-detail-withdraw-btn'));
    expect(cancelMock).not.toHaveBeenCalled();
    await user.click(await screen.findByTestId('leave-withdraw-confirm-btn'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Leave withdrawn.'));
    expect(cancelMock).toHaveBeenCalledWith('leave-1');
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers no withdraw on the applicant’s own approved leave', () => {
    state.leave = { ...PENDING_LEAVE, status: 'APPROVED' };
    renderWithProviders(<LeaveDetailPage />, { abilityRules: [...APPLICANT_RULES] });

    expect(screen.getByTestId('leave-detail-card')).toBeInTheDocument();
    expect(screen.queryByTestId('leave-detail-withdraw-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leave-detail-cancel-btn')).not.toBeInTheDocument();
  });

  it('offers no withdraw on someone else’s pending leave', () => {
    state.leave = { ...PENDING_LEAVE, userId: '018f3e2c-0000-7000-8000-0000000000bb' };
    renderWithProviders(<LeaveDetailPage />, { abilityRules: [...APPLICANT_RULES] });

    expect(screen.queryByTestId('leave-detail-withdraw-btn')).not.toBeInTheDocument();
  });

  it('lets a guardian withdraw their child’s pending leave', () => {
    state.leave = PENDING_LEAVE;
    renderWithProviders(<LeaveDetailPage />, { abilityRules: [...GUARDIAN_RULES] });

    expect(screen.getByTestId('leave-detail-withdraw-btn')).toHaveTextContent('Withdraw');
  });

  it('offers a guardian no withdraw on their child’s approved leave', () => {
    state.leave = { ...PENDING_LEAVE, status: 'APPROVED' };
    renderWithProviders(<LeaveDetailPage />, { abilityRules: [...GUARDIAN_RULES] });

    expect(screen.queryByTestId('leave-detail-withdraw-btn')).not.toBeInTheDocument();
  });

  it('keeps Cancel for approvers on an approved leave', () => {
    state.leave = { ...PENDING_LEAVE, status: 'APPROVED' };
    renderWithProviders(<LeaveDetailPage />);

    expect(screen.getByTestId('leave-detail-cancel-btn')).toHaveTextContent('Cancel');
    expect(screen.queryByTestId('leave-detail-withdraw-btn')).not.toBeInTheDocument();
  });

  it('shows the not-found state when the id is not a valid leave id', () => {
    state.error = graphQLError('BAD_REQUEST');
    renderWithProviders(<LeaveDetailPage />);

    expect(screen.getByTestId('leave-detail-not-found')).toHaveTextContent('Leave not found');
    expect(screen.queryByTestId('leave-detail-retry-btn')).not.toBeInTheDocument();
  });

  describe('class teacher', () => {
    it('offers Withdraw with a confirmation, and no decision, on an own pending leave', async () => {
      state.leave = { ...PENDING_LEAVE, userId: TEACHER_MEMBERSHIP_ID };
      cancelMock.mockResolvedValue({});
      const user = userEvent.setup();
      renderWithProviders(<LeaveDetailPage />, { abilityRules: [...CLASS_TEACHER_RULES] });

      expect(screen.queryByTestId('leave-detail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-detail-reject-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-detail-cancel-btn')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('leave-detail-withdraw-btn'));
      expect(cancelMock).not.toHaveBeenCalled();
      await user.click(await screen.findByTestId('leave-withdraw-confirm-btn'));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Leave withdrawn.'));
      expect(cancelMock).toHaveBeenCalledWith('leave-1');
    });

    it('offers no action on an own approved leave', () => {
      state.leave = { ...PENDING_LEAVE, userId: TEACHER_MEMBERSHIP_ID, status: 'APPROVED' };
      renderWithProviders(<LeaveDetailPage />, { abilityRules: [...CLASS_TEACHER_RULES] });

      expect(screen.getByTestId('leave-detail-card')).toBeInTheDocument();
      expect(screen.queryByTestId('leave-detail-cancel-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leave-detail-withdraw-btn')).not.toBeInTheDocument();
    });

    it('offers Approve, Reject and Cancel on a section student’s pending leave', () => {
      state.leave = PENDING_LEAVE;
      renderWithProviders(<LeaveDetailPage />, { abilityRules: [...CLASS_TEACHER_RULES] });

      expect(screen.getByTestId('leave-detail-approve-btn')).toBeInTheDocument();
      expect(screen.getByTestId('leave-detail-reject-btn')).toBeInTheDocument();
      expect(screen.getByTestId('leave-detail-cancel-btn')).toHaveTextContent('Cancel');
      expect(screen.queryByTestId('leave-detail-withdraw-btn')).not.toBeInTheDocument();
    });
  });
});
