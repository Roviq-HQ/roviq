/**
 * ROV-168 — Component test for the admission applications page.
 *
 * Verifies the 18-status pipeline rendering, RTE badge, status-change action
 * visibility, the FEE_PAID → ENROLLED approve flow, and the documents dialog.
 */

import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ErrorCode } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import messagesEn from '../../../../../../../../messages/en/admission.json';
import studentsEn from '../../../../../../../../messages/en/students.json';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

const { instituteAdmissionApplications } = testIds;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/admission/applications',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

const setFilters = vi.hoisted(() => vi.fn());

vi.mock('../../../academics/use-academics', () => ({
  useStandards: () => ({
    standards: [
      { id: 'std-1', name: { en: 'Class 1' } },
      { id: 'std-2', name: { en: 'Class 2' } },
    ],
    loading: false,
  }),
}));

vi.mock('nuqs', () => {
  const cache = new WeakMap<object, [Record<string, unknown>, ReturnType<typeof vi.fn>]>();
  return {
    useQueryStates: (parsers: Record<string, unknown>) => {
      let entry = cache.get(parsers);
      if (!entry) {
        const defaults: Record<string, unknown> = { rteOnly: false };
        for (const key of Object.keys(parsers)) {
          if (!(key in defaults)) defaults[key] = null;
        }
        entry = [defaults, setFilters];
        cache.set(parsers, entry);
      }
      return entry;
    },
    parseAsString: { withDefault: () => ({}) },
    parseAsBoolean: { withDefault: () => ({ withDefault: () => ({}) }) },
  };
});

const baseApp = {
  id: 'app-1',
  enquiryId: null,
  academicYearId: 'ay-1',
  standardId: 'std-classroom-id-1234',
  standardName: { en: 'Class 1', hi: 'कक्षा 1' },
  sectionId: null,
  formData: { studentName: 'Diya Patel', parentName: 'Meera Patel' },
  isRteApplication: true,
  testScore: null,
  interviewScore: null,
  meritRank: null,
  rteLotteryRank: null,
  offeredAt: null,
  offerExpiresAt: null,
  offerAcceptedAt: null,
  rejectionReason: null,
  rejectedAt: null,
  studentProfileId: null,
  version: 1,
  createdAt: new Date('2026-04-15T10:00:00Z').toISOString(),
  updatedAt: new Date('2026-04-15T10:00:00Z').toISOString(),
};

const unnamedApp = {
  ...baseApp,
  id: '01a2b3c4-d5e6-7f80-9a0b-1c2d3e4f5a6b',
  status: 'SUBMITTED',
  formData: {},
};
const feePaidApp = { ...baseApp, id: 'app-2', status: 'FEE_PAID', isRteApplication: false };
const submittedApp = { ...baseApp, status: 'SUBMITTED' };
const rejectedApp = {
  ...baseApp,
  id: 'app-3',
  status: 'REJECTED',
  rejectionReason: 'Seats full for Class 1',
  rejectedAt: new Date('2026-04-16T10:00:00Z').toISOString(),
};

const birthCertificate = {
  id: 'doc-1',
  applicationId: 'app-1',
  type: 'BIRTH_CERTIFICATE',
  createdAt: new Date('2026-04-15T10:00:00Z').toISOString(),
  files: [
    { id: 'file-1', name: 'birth-certificate.pdf' },
    { id: 'file-2', name: 'page-2.jpg' },
  ],
};

const refetch = vi.fn();
const listState = { failed: false, unnamed: false };
const approve = vi.fn((_options: unknown) => Promise.resolve({}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('../../use-admission', () => ({
  useApplications: () =>
    listState.failed
      ? {
          applications: [],
          totalCount: 0,
          hasNextPage: false,
          endCursor: null,
          loading: false,
          error: new Error('boom'),
          refetch,
          fetchMore: vi.fn(),
        }
      : {
          applications: listState.unnamed ? [unnamedApp] : [submittedApp, feePaidApp, rejectedApp],
          totalCount: 3,
          hasNextPage: false,
          endCursor: null,
          loading: false,
          error: undefined,
          refetch,
          fetchMore: vi.fn(),
        },
  useApplicationStatusChanged: vi.fn(),
  useUpdateApplication: () => [vi.fn(), { loading: false }],
  useApproveApplication: () => [approve, { loading: false }],
  useSectionsForAdmission: () => ({
    data: { sections: [{ id: 'sec-1', name: { en: 'A' }, capacity: 40, currentStrength: 12 }] },
    loading: false,
  }),
  useRejectApplication: () => [vi.fn(), { loading: false }],
  useApplicationDocuments: (applicationId: string | null) => ({
    data: applicationId ? { listApplicationDocuments: [birthCertificate] } : undefined,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  useAddApplicationDocument: () => [vi.fn(), { loading: false }],
  useRemoveApplicationDocument: () => [vi.fn(), { loading: false }],
}));

// Both talk to the API on their own; the dialog only places them.
vi.mock('@web/components/file-upload/file-upload', () => ({
  FileUpload: ({ label }: { label: string }) => <div>{label}</div>,
}));
vi.mock('@web/components/file-upload/file-download-button', () => ({
  FileDownloadButton: ({ label, testId }: { label: string; testId: string }) => (
    <button type="button" data-testid={testId}>
      {label}
    </button>
  ),
}));

import ApplicationsPage from '../page';

function renderPage() {
  return renderWithProviders(<ApplicationsPage />, {
    messages: { admission: messagesEn, students: studentsEn },
  });
}

describe('ApplicationsPage (component)', () => {
  it('renders title + applicant name pulled from formData', () => {
    renderPage();
    expect(screen.getByTestId('applications-title')).toHaveTextContent(
      messagesEn.applications.title,
    );
    expect(screen.getByTestId('application-applicant-app-1')).toHaveTextContent('Diya Patel');
  });

  it('shows a copyable id, not a shortened one, for an applicant without a name (ROV-360)', async () => {
    const user = userEvent.setup();
    listState.unnamed = true;
    renderPage();

    const cell = screen.getByTestId(instituteAdmissionApplications.applicant(unnamedApp.id));
    expect(cell).toHaveTextContent(messagesEn.applications.unnamedApplicant);
    expect(cell).not.toHaveTextContent(unnamedApp.id.slice(0, 8));

    await user.click(within(cell).getByTestId(testIds.copyId.button(unnamedApp.id)));
    expect(await navigator.clipboard.readText()).toBe(unnamedApp.id);
    expect(toast.success).toHaveBeenCalledWith('Copied!', { duration: 2000 });
    listState.unnamed = false;
  });

  it('names the class applied for instead of showing its id', () => {
    renderPage();
    // All three fixture applications are for the same class.
    expect(screen.getAllByText('Class 1')).toHaveLength(3);
    expect(screen.queryByText(/std-clas/)).not.toBeInTheDocument();
  });

  it('explains a refused approval in translated copy, not the server message', async () => {
    approve.mockRejectedValueOnce(
      new CombinedGraphQLErrors({
        errors: [
          {
            message: 'raw server text',
            extensions: { code: ErrorCode.SECTION_STANDARD_MISMATCH },
          },
        ],
      }),
    );
    renderPage();
    await userEvent.click(screen.getByTestId('application-approve-btn-app-2'));
    await userEvent.click(screen.getByTestId(instituteAdmissionApplications.approveSectionSelect));
    await userEvent.click(
      await screen.findByTestId(instituteAdmissionApplications.approveSectionOption('sec-1')),
    );
    await userEvent.click(screen.getByTestId(instituteAdmissionApplications.approveConfirmBtn));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(messagesEn.applications.approveDialog.error, {
        description: messagesEn.errors.sectionStandardMismatch,
      }),
    );
  });

  it('renders the RTE badge only on RTE applications', () => {
    renderPage();
    expect(screen.getByTestId('application-rte-app-1')).toHaveTextContent(
      messagesEn.applications.rteBadge,
    );
    expect(screen.queryByTestId('application-rte-app-2')).not.toBeInTheDocument();
  });

  it('shows status badges with localised labels', () => {
    renderPage();
    expect(screen.getByTestId('application-status-app-1')).toHaveTextContent(
      messagesEn.applicationStatuses.SUBMITTED,
    );
    expect(screen.getByTestId('application-status-app-2')).toHaveTextContent(
      messagesEn.applicationStatuses.FEE_PAID,
    );
  });

  it('only surfaces the approve button on FEE_PAID applications', () => {
    renderPage();
    expect(screen.queryByTestId('application-approve-btn-app-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('application-approve-btn-app-2')).toBeInTheDocument();
  });

  it('opens the approve confirmation dialog when approve is clicked', async () => {
    renderPage();
    await userEvent.click(screen.getByTestId('application-approve-btn-app-2'));
    const dialog = await screen.findByTestId('approve-application-dialog');
    expect(
      within(dialog).getByText(messagesEn.applications.approveDialog.title),
    ).toBeInTheDocument();
  });

  it('opens the status-change dialog with valid next states', async () => {
    renderPage();
    await userEvent.click(screen.getByTestId('application-status-btn-app-1'));
    expect(await screen.findByTestId('status-change-dialog')).toBeInTheDocument();
  });

  it('lists the documents of an open application with one button per page and lets them change', async () => {
    renderPage();
    await userEvent.click(screen.getByTestId(instituteAdmissionApplications.documentsBtn('app-1')));

    const dialog = await screen.findByTestId(instituteAdmissionApplications.documentsDialog);
    const row = within(dialog).getByTestId(instituteAdmissionApplications.documentRow('doc-1'));
    expect(row).toHaveTextContent(studentsEn.detail.documents.types.BIRTH_CERTIFICATE);
    expect(
      within(row).getByTestId(instituteAdmissionApplications.documentPageBtn('file-1')),
    ).toHaveTextContent('Page 1');
    expect(
      within(row).getByTestId(instituteAdmissionApplications.documentPageBtn('file-2')),
    ).toHaveTextContent('Page 2');
    expect(
      within(row).getByTestId(instituteAdmissionApplications.documentRemoveBtn('doc-1')),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId(instituteAdmissionApplications.documentAddBtn),
    ).toBeDisabled();
  });

  it('shows the documents of a closed application without add or remove', async () => {
    renderPage();
    await userEvent.click(screen.getByTestId(instituteAdmissionApplications.documentsBtn('app-3')));

    const dialog = await screen.findByTestId(instituteAdmissionApplications.documentsDialog);
    expect(
      within(dialog).getByTestId(instituteAdmissionApplications.documentsClosedNote),
    ).toHaveTextContent(messagesEn.applications.documentsDialog.closed);
    expect(
      within(dialog).getByTestId(instituteAdmissionApplications.documentPageBtn('file-1')),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByTestId(instituteAdmissionApplications.documentAddBtn),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByTestId(instituteAdmissionApplications.documentRemoveBtn('doc-1')),
    ).not.toBeInTheDocument();
  });

  it('shows the rejection reason only on applications that have one', () => {
    renderPage();
    expect(
      screen.getByTestId(instituteAdmissionApplications.rejectionReason('app-3')),
    ).toHaveTextContent('Reason: Seats full for Class 1');
    expect(
      screen.queryByTestId(instituteAdmissionApplications.rejectionReason('app-1')),
    ).not.toBeInTheDocument();
  });

  it('offers Change status only where a status can still be picked by hand', () => {
    renderPage();
    // FEE_PAID's only next step is enrolment, through Approve; REJECTED is terminal.
    expect(screen.queryByTestId('application-status-btn-app-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('application-status-btn-app-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('application-status-btn-app-1')).toBeEnabled();
  });

  it('filters by a standard picked from the institute’s standards', async () => {
    renderPage();
    await userEvent.click(screen.getByTestId(instituteAdmissionApplications.standardFilter));
    await userEvent.click(await screen.findByRole('option', { name: 'Class 2' }));

    expect(setFilters).toHaveBeenCalledWith({ standardId: 'std-2' });
  });

  it('requires a section before the approve dialog can be confirmed', async () => {
    renderPage();
    await userEvent.click(screen.getByTestId('application-approve-btn-app-2'));
    const confirm = await screen.findByTestId(instituteAdmissionApplications.approveConfirmBtn);
    expect(confirm).toBeDisabled();

    await userEvent.click(screen.getByTestId(instituteAdmissionApplications.approveSectionSelect));
    await userEvent.click(
      await screen.findByTestId(instituteAdmissionApplications.approveSectionOption('sec-1')),
    );
    await userEvent.click(confirm);

    expect(approve).toHaveBeenCalledWith({ variables: { id: 'app-2', sectionId: 'sec-1' } });
  });

  it('shows an error with retry, not the empty state, when the list fails to load', async () => {
    listState.failed = true;
    try {
      renderPage();
      expect(screen.getByTestId(instituteAdmissionApplications.loadError)).toHaveTextContent(
        messagesEn.applications.loadError.title,
      );
      expect(
        screen.queryByTestId(instituteAdmissionApplications.emptyNoData),
      ).not.toBeInTheDocument();

      refetch.mockClear();
      await userEvent.click(screen.getByTestId(instituteAdmissionApplications.loadErrorRetryBtn));
      expect(refetch).toHaveBeenCalledTimes(1);
    } finally {
      listState.failed = false;
    }
  });
});
