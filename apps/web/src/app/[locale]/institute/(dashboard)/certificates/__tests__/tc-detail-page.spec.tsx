/**
 * TC detail page: clearances arrive as `[{ department, cleared }]` and every TcStatus the API
 * can return has copy in both locales (the provider throws on a missing message).
 */
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ErrorCode, TC_STATUS_VALUES, type TcStatus } from '@roviq/common-types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messagesEn from '../../../../../../../messages/en/certificates.json';
import messagesHi from '../../../../../../../messages/hi/certificates.json';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';

const STATUS_COPY = { en: messagesEn.tcStatuses, hi: messagesHi.tcStatuses };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: 'tc-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/certificates/tc/tc-1',
}));

const tcState = vi.hoisted(() => ({
  status: 'GENERATED',
  isDuplicate: false,
  tcData: null as Record<string, string | null> | null,
}));

function tcNode(status: string) {
  return {
    id: 'tc-1',
    tcSerialNumber: tcState.isDuplicate ? 'TC-DUP-1' : 'TC/2026/001',
    status,
    reason: 'Family relocated to another city',
    isDuplicate: tcState.isDuplicate,
    isCounterSigned: false,
    originalTcId: tcState.isDuplicate ? 'tc-original' : null,
    pdfUrl: null,
    qrVerificationUrl: null,
    academicYearId: 'year-1',
    studentProfileId: 'student-1',
    studentFirstName: { en: 'Asha' },
    studentLastName: null,
    standardName: null,
    clearances: [
      { department: 'accounts', cleared: true, by: null, at: '2026-11-20T10:00:00Z', notes: null },
      { department: 'library', cleared: false, by: null, at: null, notes: 'Two books due' },
    ],
    tcData: tcState.tcData,
    createdAt: '2026-11-20T09:00:00Z',
  };
}

const ORIGINAL = { ...tcNode('ISSUED'), id: 'tc-original', tcSerialNumber: 'TC/2026/001' };
const DUPLICATES = [
  {
    ...tcNode('DUPLICATE_ISSUED'),
    id: 'tc-dup-1',
    tcSerialNumber: 'TC/2026/001-D1',
    isDuplicate: true,
  },
];

const approve: [ReturnType<typeof vi.fn>, { loading: boolean }] = [vi.fn(), { loading: false }];
const issue: [ReturnType<typeof vi.fn>, { loading: boolean }] = [vi.fn(), { loading: false }];
const other: [ReturnType<typeof vi.fn>, { loading: boolean }] = [vi.fn(), { loading: false }];
const useTCsMock = vi.fn((_filter: { originalTcId?: string }) => ({
  tcs: DUPLICATES,
  loading: false,
  refetch: vi.fn(),
}));
vi.mock('../use-certificates', () => ({
  useTC: (id: string) => ({
    data: { getTCDetails: id === 'tc-original' ? ORIGINAL : tcNode(tcState.status) },
    loading: false,
  }),
  useTCs: (filter: { originalTcId?: string }) => useTCsMock(filter),
  useApproveTC: () => approve,
  useIssueTC: () => issue,
  useRejectTC: () => other,
  useRequestDuplicateTC: () => other,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  tcState.status = 'GENERATED';
  tcState.isDuplicate = false;
  tcState.tcData = null;
});

import TCDetailPage from '../tc/[id]/page';

describe('TCDetailPage (component)', () => {
  it('offers Issue Duplicate and Reject, but not Approve, on a duplicate request', () => {
    tcState.status = 'DUPLICATE_REQUESTED';
    tcState.isDuplicate = true;
    renderWithProviders(<TCDetailPage />);

    expect(screen.getByRole('button', { name: messagesEn.tc.issueDuplicate })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messagesEn.tc.reject })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: messagesEn.tc.approve })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: messagesEn.tc.requestDuplicate }),
    ).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Duplicate of TC/2026/001' });
    expect(link).toHaveAttribute('href', '/en/institute/certificates/tc/tc-original');
  });

  it('issues a duplicate only after the confirm dialog', async () => {
    const user = userEvent.setup();
    tcState.status = 'DUPLICATE_REQUESTED';
    tcState.isDuplicate = true;
    issue[0].mockResolvedValue({});
    renderWithProviders(<TCDetailPage />);

    await user.click(screen.getByRole('button', { name: messagesEn.tc.issueDuplicate }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(messagesEn.tc.confirm.issueDuplicate.title),
    ).toBeInTheDocument();
    expect(issue[0]).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole('button', { name: messagesEn.tc.confirm.issueDuplicate.confirm }),
    );

    expect(issue[0]).toHaveBeenCalledWith({ variables: { id: 'tc-1' } });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(messagesEn.tc.confirm.issueDuplicate.success),
    );
  });

  it('approves a generated TC after the confirm dialog', async () => {
    const user = userEvent.setup();
    approve[0].mockResolvedValue({});
    renderWithProviders(<TCDetailPage />);

    await user.click(screen.getByRole('button', { name: messagesEn.tc.approve }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: messagesEn.tc.confirm.approve.confirm }),
    );

    expect(approve[0]).toHaveBeenCalledWith({ variables: { id: 'tc-1' } });
  });

  it('explains a refused issue by its error code, never the server text', async () => {
    const user = userEvent.setup();
    tcState.status = 'APPROVED';
    issue[0].mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [
          { message: 'raw server text', extensions: { code: ErrorCode.INVALID_STATE_TRANSITION } },
        ],
      }),
    );
    renderWithProviders(<TCDetailPage />);

    await user.click(screen.getByRole('button', { name: messagesEn.tc.issue }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: messagesEn.tc.confirm.issue.confirm }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(messagesEn.tc.confirm.issue.error, {
        description: messagesEn.tc.errors.invalidState,
      }),
    );
  });

  it('lists the duplicates of an issued TC', () => {
    tcState.status = 'ISSUED';
    renderWithProviders(<TCDetailPage />);

    expect(useTCsMock).toHaveBeenCalledWith({ originalTcId: 'tc-1' });
    const link = screen.getByRole('link', { name: 'TC/2026/001-D1' });
    expect(link).toHaveAttribute('href', '/en/institute/certificates/tc/tc-dup-1');
    expect(
      screen.getByRole('button', { name: messagesEn.tc.requestDuplicate }),
    ).toBeInTheDocument();
  });

  it('labels the TC fields in certificate order and hides unknown keys', () => {
    tcState.status = 'GENERATED';
    tcState.tcData = {
      classLastStudied: 'Class 5',
      studentName: 'Asha Kumari',
      rejected_by: 'user-1',
    };
    renderWithProviders(<TCDetailPage />, { locale: 'hi' });

    expect(screen.getByText(messagesHi.tc.tcDataTitle)).toBeInTheDocument();
    const name = screen.getByText(messagesHi.tc.fields.studentName);
    const cls = screen.getByText(messagesHi.tc.fields.classLastStudied);
    expect(name.compareDocumentPosition(cls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Class 5')).toBeInTheDocument();
    expect(screen.queryByText('rejected_by')).not.toBeInTheDocument();
    expect(screen.queryByText('user-1')).not.toBeInTheDocument();
  });

  it('shows snapshot dates in the app date format and the social category as its label', () => {
    tcState.tcData = {
      socialCategory: 'GENERAL',
      dateOfBirthFigures: '2015-06-15',
      dateOfLeaving: '2026-11-21',
      dateOfBirthWords: 'Fifteenth June Two Thousand Fifteen',
    };
    renderWithProviders(<TCDetailPage />);

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.queryByText('GENERAL')).not.toBeInTheDocument();
    expect(screen.getByText('15/06/2015')).toBeInTheDocument();
    expect(screen.getByText('21/11/2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-11-21')).not.toBeInTheDocument();
    expect(screen.getByText('Fifteenth June Two Thousand Fifteen')).toBeInTheDocument();
  });

  it('shows no department clearances on a duplicate, which skips clearance', () => {
    tcState.status = 'DUPLICATE_REQUESTED';
    tcState.isDuplicate = true;
    renderWithProviders(<TCDetailPage />);

    expect(screen.queryByText(messagesEn.tc.clearanceTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(messagesEn.tc.noClearances)).not.toBeInTheDocument();
  });

  it('shows the department clearances on an original TC', () => {
    renderWithProviders(<TCDetailPage />);

    expect(screen.getByText(messagesEn.tc.clearanceTitle)).toBeInTheDocument();
  });

  it('shows the no-permission state to a role without TC access', () => {
    renderWithProviders(<TCDetailPage />, {
      abilityRules: [{ action: 'read', subject: 'Student' }],
    });

    expect(screen.getByText(messagesEn.tc.accessDenied.title)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('lists each clearance by its translated department name with its own state', () => {
    tcState.status = 'GENERATED';
    renderWithProviders(<TCDetailPage />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Accounts')).toBeInTheDocument();
    expect(within(items[0]).getByText('Cleared')).toBeInTheDocument();
    expect(within(items[1]).getByText('Library')).toBeInTheDocument();
    expect(within(items[1]).getByText('Pending')).toBeInTheDocument();
    expect(within(items[1]).getByText('Two books due')).toBeInTheDocument();
  });

  it('shows Hindi department names', () => {
    tcState.status = 'GENERATED';
    renderWithProviders(<TCDetailPage />, { locale: 'hi' });

    expect(screen.getByText('लेखा')).toBeInTheDocument();
    expect(screen.getByText('पुस्तकालय')).toBeInTheDocument();
  });

  it.each(
    TC_STATUS_VALUES.flatMap((status: TcStatus) => [
      { status, locale: 'en' as const },
      { status, locale: 'hi' as const },
    ]),
  )('renders the $status badge in $locale', ({ status, locale }) => {
    tcState.status = status;
    renderWithProviders(<TCDetailPage />, { locale });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('TC/2026/001');
    expect(screen.getAllByText(STATUS_COPY[locale][status]).length).toBeGreaterThan(0);
  });
});
