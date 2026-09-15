/**
 * Component tests for the staff timetable page's data states.
 *
 * The page mounts the whole staff view and scopes assertions to its testIds.
 * A request failure must render the distinct load-failed state (with retry),
 * never the "no active timetable" empty state — conflating the two hid a
 * transient outage behind a data message.
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/timetable/staff-timetable',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

// Auth state is mutable per test: the page derives the "self" teacher from
// the signed-in user first, falling back to matching the JWT tenant+role
// against the membership list.
const authState: {
  user: { membershipId: string } | null;
  token: string | null;
  memberships: { tenantId: string; roleId: string; membershipId: string }[];
} = { user: null, token: null, memberships: [] };

vi.mock('@roviq/auth', () => ({
  useAuth: () => ({
    user: authState.user,
    getAccessToken: () => authState.token,
    memberships: authState.memberships,
  }),
  decodeJwt: (token: string) =>
    token === 'jwt-1' ? { tenantId: 'ten-1', roleId: 'role-1' } : null,
}));

// Captures the teacherId + timetableId the page passes to the grid query.
let capturedTeacherId: string | null | undefined;
let capturedTimetableId: string | undefined;

vi.mock('../../use-timetable', () => ({
  useStaffTimetable: (teacherId: string | null, timetableId?: string) => {
    capturedTeacherId = teacherId;
    capturedTimetableId = timetableId;
    return {
      grid: hookState.grid,
      loading: hookState.loading,
      error: hookState.error,
      refetch: hookState.refetch,
    };
  },
  useStaffTimetablePdf: () => [vi.fn(), { loading: false }],
  useTimetables: () => ({
    timetables: timetablesState.timetables,
    loading: timetablesState.loading,
    error: undefined,
    refetch: () => undefined,
  }),
}));

const timetablesState: { timetables: { id: string }[]; loading: boolean } = {
  timetables: [{ id: 'tt-1' }],
  loading: false,
};

const lookupsState: {
  teacherOptions: { value: string; label: string }[];
  loading: boolean;
} = { teacherOptions: [], loading: false };

vi.mock('../../use-timetable-lookups', () => ({
  TimetableLookupsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTimetableLookups: () => ({
    teacherOptions: lookupsState.teacherOptions,
    loading: lookupsState.loading,
    subjectLabel: () => '',
    sectionLabel: () => '',
  }),
}));

const hookState: {
  grid: { timetableId: string; periods: never[]; workingDays: never[]; entries: never[] } | null;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
} = { grid: null, loading: false, error: undefined, refetch: () => undefined };

// Import AFTER mocks.
import StaffTimetablePage from '../page';

const { instituteTimetable } = testIds;

describe('StaffTimetablePage data states', () => {
  it('renders the grid when the query returns one', () => {
    authState.user = { membershipId: 'mem-1' };
    authState.token = null;
    authState.memberships = [];
    hookState.grid = { timetableId: 'tt-1', periods: [], workingDays: [], entries: [] };
    hookState.loading = false;
    hookState.error = undefined;
    renderWithProviders(<StaffTimetablePage />);

    expect(screen.getByTestId(instituteTimetable.staffGrid)).toBeInTheDocument();
    expect(screen.queryByTestId(instituteTimetable.staffGridError)).not.toBeInTheDocument();
  });

  it('renders the no-timetable empty state only when there is no error', () => {
    authState.user = { membershipId: 'mem-1' };
    authState.token = null;
    authState.memberships = [];
    hookState.grid = null;
    hookState.loading = false;
    hookState.error = undefined;
    renderWithProviders(<StaffTimetablePage />);

    expect(screen.getByText('No active timetable found for this selection.')).toBeInTheDocument();
    expect(screen.queryByTestId(instituteTimetable.staffGridError)).not.toBeInTheDocument();
  });

  it('renders the load-failed state with a working retry on error', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    authState.user = { membershipId: 'mem-1' };
    authState.token = null;
    authState.memberships = [];
    hookState.grid = null;
    hookState.loading = false;
    hookState.error = new Error('boom');
    hookState.refetch = refetch;
    renderWithProviders(<StaffTimetablePage />);

    expect(screen.getByTestId(instituteTimetable.staffGridError)).toBeInTheDocument();
    expect(
      screen.queryByText('No active timetable found for this selection.'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId(instituteTimetable.staffGridRetryBtn));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('resolves self to the signed-in membership id, not the JWT role match', () => {
    authState.user = { membershipId: 'mem-1' };
    authState.token = 'jwt-1';
    authState.memberships = [{ tenantId: 'ten-1', roleId: 'role-1', membershipId: 'mem-9' }];
    hookState.grid = null;
    hookState.loading = false;
    hookState.error = undefined;
    renderWithProviders(<StaffTimetablePage />);

    expect(capturedTeacherId).toBe('mem-1');
  });

  it('falls back to the JWT tenant+role match when the user has no membership id', () => {
    authState.user = null;
    authState.token = 'jwt-1';
    authState.memberships = [{ tenantId: 'ten-1', roleId: 'role-1', membershipId: 'mem-9' }];
    hookState.grid = null;
    hookState.loading = false;
    hookState.error = undefined;
    renderWithProviders(<StaffTimetablePage />);

    expect(capturedTeacherId).toBe('mem-9');
  });

  it('hides the teacher picker when the staff directory yields no options', () => {
    authState.user = { membershipId: 'mem-1' };
    authState.token = null;
    authState.memberships = [];
    lookupsState.teacherOptions = [];
    lookupsState.loading = false;
    hookState.grid = { timetableId: 'tt-1', periods: [], workingDays: [], entries: [] };
    hookState.loading = false;
    hookState.error = undefined;
    renderWithProviders(<StaffTimetablePage />);

    expect(screen.queryByTestId(instituteTimetable.staffTeacherSelect)).not.toBeInTheDocument();
    expect(screen.getByTestId(instituteTimetable.staffGrid)).toBeInTheDocument();
  });

  it('shows the teacher picker when staff options exist', () => {
    authState.user = { membershipId: 'mem-1' };
    authState.token = null;
    authState.memberships = [];
    lookupsState.teacherOptions = [{ value: 'mem-2', label: 'Aarav Sharma' }];
    lookupsState.loading = false;
    hookState.grid = { timetableId: 'tt-1', periods: [], workingDays: [], entries: [] };
    hookState.loading = false;
    hookState.error = undefined;
    renderWithProviders(<StaffTimetablePage />);

    expect(screen.getByTestId(instituteTimetable.staffTeacherSelect)).toBeInTheDocument();
  });

  it('scopes the grid to the active timetable', () => {
    authState.user = { membershipId: 'mem-1' };
    authState.token = null;
    authState.memberships = [];
    timetablesState.timetables = [{ id: 'tt-active' }];
    timetablesState.loading = false;
    hookState.grid = null;
    hookState.loading = false;
    hookState.error = undefined;
    renderWithProviders(<StaffTimetablePage />);

    expect(capturedTimetableId).toBe('tt-active');
  });

  it('shows the empty state without querying when no timetable is active', () => {
    authState.user = { membershipId: 'mem-1' };
    authState.token = null;
    authState.memberships = [];
    timetablesState.timetables = [];
    timetablesState.loading = false;
    hookState.grid = null;
    hookState.loading = false;
    hookState.error = undefined;
    renderWithProviders(<StaffTimetablePage />);

    expect(capturedTeacherId).toBeNull();
    expect(screen.getByText('No active timetable found for this selection.')).toBeInTheDocument();
  });
});
