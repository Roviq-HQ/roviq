import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { RawRuleOf } from '@casl/ability';
import { type AppAbility, eligibleComplianceReportTypes } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

const { adminInstituteDetail: ids } = testIds;

interface QueryState {
  data: Record<string, unknown> | undefined;
  loading: boolean;
  error: Error | undefined;
}

const state = vi.hoisted(() => ({
  years: { data: undefined, loading: false, error: undefined } as {
    data: Record<string, unknown> | undefined;
    loading: boolean;
    error: Error | undefined;
  },
  history: { data: undefined, loading: false, error: undefined } as {
    data: Record<string, unknown> | undefined;
    loading: boolean;
    error: Error | undefined;
  },
  refetch: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  requestExport: vi.fn(),
  queryDocs: { years: null as unknown, history: null as unknown },
}));

vi.mock('@roviq/graphql', async () => {
  const actual = await vi.importActual<typeof import('@roviq/graphql')>('@roviq/graphql');
  return {
    ...actual,
    useQuery: (doc: unknown) => {
      const source: QueryState = doc === state.queryDocs.years ? state.years : state.history;
      return {
        ...source,
        refetch: state.refetch,
        startPolling: state.startPolling,
        stopPolling: state.stopPolling,
      };
    },
    useMutation: () => [state.requestExport, { loading: false }],
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  ADMIN_LIST_EXPORT_ACADEMIC_YEARS,
  ADMIN_LIST_EXPORT_REPORTS,
  availableReportTypes,
  EXPORT_POLL_INTERVAL_MS,
  type ExportInstituteProfile,
  type ExportReportRow,
  InstituteExportsTab,
} from '../exports-tab';

const INSTITUTE_ID = '00000000-0000-7000-a000-0000000000a1';
const YEAR_ID = '00000000-0000-7000-a000-0000000000c1';
const OLD_YEAR_ID = '00000000-0000-7000-a000-0000000000c0';

const CBSE_INSTITUTE: ExportInstituteProfile = {
  affiliations: [{ board: 'CBSE', affiliationStatus: 'REGULAR' }],
  address: { state: 'Delhi' },
  identifiers: [],
};

function report(overrides: Partial<ExportReportRow> = {}): ExportReportRow {
  return {
    id: 'report-1',
    reportType: 'UDISE_DCF',
    academicYearId: YEAR_ID,
    academicYearLabel: '2025-26',
    status: 'PENDING',
    rowCount: null,
    errorCode: null,
    requesterFirstName: { en: 'Asha' },
    requesterLastName: { en: 'Rao' },
    requestedAt: '2026-11-20T05:30:00.000Z',
    completedAt: null,
    file: null,
    ...overrides,
  };
}

function setHistory(rows: ExportReportRow[]) {
  state.history = { data: { adminListExportReports: rows }, loading: false, error: undefined };
}

function renderTab(
  institute: ExportInstituteProfile = CBSE_INSTITUTE,
  abilityRules?: RawRuleOf<AppAbility>[],
) {
  return renderWithProviders(
    <InstituteExportsTab instituteId={INSTITUTE_ID} institute={institute} />,
    abilityRules ? { abilityRules } : {},
  );
}

beforeEach(() => {
  state.queryDocs.years = ADMIN_LIST_EXPORT_ACADEMIC_YEARS;
  state.queryDocs.history = ADMIN_LIST_EXPORT_REPORTS;
  state.years = {
    data: {
      adminListExportAcademicYears: [
        { id: YEAR_ID, label: '2025-26', isActive: true },
        { id: OLD_YEAR_ID, label: '2024-25', isActive: false },
      ],
    },
    loading: false,
    error: undefined,
  };
  setHistory([]);
  state.refetch.mockReset().mockResolvedValue({});
  state.startPolling.mockReset();
  state.stopPolling.mockReset();
  state.requestExport.mockReset().mockResolvedValue({
    data: { adminExportComplianceReport: { id: 'report-1', status: 'PENDING' } },
  });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe('availableReportTypes', () => {
  it('should ask the shared eligibility rule, passing only live affiliations', () => {
    const profile: ExportInstituteProfile = {
      affiliations: [
        { board: 'CBSE', affiliationStatus: 'REGULAR' },
        { board: 'BSEH', affiliationStatus: 'REVOKED' },
      ],
      address: { state: 'Haryana' },
      identifiers: [{ type: 'UDISE_PLUS' }],
    };

    expect(availableReportTypes(profile)).toEqual(
      eligibleComplianceReportTypes({
        boards: ['CBSE'],
        state: 'Haryana',
        identifierTypes: ['UDISE_PLUS'],
      }),
    );
  });

  it('should not offer BSEH or Shala Darpan to a CBSE institute in Haryana', () => {
    const types = availableReportTypes({
      affiliations: [{ board: 'CBSE', affiliationStatus: 'REGULAR' }],
      address: { state: 'Haryana' },
    });

    expect(types).toContain('CBSE_LOC');
    expect(types).not.toContain('BSEH_STAFF_STATEMENT');
    expect(types).not.toContain('SHALA_DARPAN');
  });

  it('should not offer a board’s exports when the affiliation is revoked', () => {
    const types = availableReportTypes({
      affiliations: [{ board: 'CBSE', affiliationStatus: 'REVOKED' }],
    });

    expect(types).not.toContain('CBSE_REGISTRATION');
    expect(types).not.toContain('CBSE_LOC');
  });
});

describe('InstituteExportsTab', () => {
  it('should show a card per offered report type and none for other boards', () => {
    renderTab();

    for (const type of ['UDISE_DCF', 'CBSE_REGISTRATION', 'CBSE_LOC', 'RTE_REPORT', 'AWR']) {
      expect(screen.getByTestId(ids.exportCard(type))).toBeInTheDocument();
    }
    expect(screen.queryByTestId(ids.exportCard('BSEH_STAFF_STATEMENT'))).not.toBeInTheDocument();
    expect(screen.queryByTestId(ids.exportCard('SHALA_DARPAN'))).not.toBeInTheDocument();
  });

  it('should start an export for the current academic year and refresh the history', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByTestId(ids.exportGenerateBtn('UDISE_DCF')));

    expect(state.requestExport).toHaveBeenCalledWith({
      variables: {
        input: { instituteId: INSTITUTE_ID, reportType: 'UDISE_DCF', academicYearId: YEAR_ID },
      },
    });
    await waitFor(() => expect(state.refetch).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(
      'Export started. It will be ready here in a moment.',
    );
  });

  it('should show progress and poll while an export runs, then a download once it completes', () => {
    setHistory([report({ status: 'RUNNING' })]);
    const view = renderTab();

    const card = screen.getByTestId(ids.exportCard('UDISE_DCF'));
    expect(within(card).getByTestId(ids.exportProgress('UDISE_DCF'))).toHaveTextContent(
      'Generating…',
    );
    expect(within(card).getByTestId(ids.exportGenerateBtn('UDISE_DCF'))).toBeDisabled();
    expect(state.startPolling).toHaveBeenCalledWith(EXPORT_POLL_INTERVAL_MS);

    state.stopPolling.mockReset();
    setHistory([
      report({
        status: 'COMPLETED',
        rowCount: 1240,
        completedAt: '2026-11-20T05:31:00.000Z',
        file: { id: 'file-1', sizeBytes: 48_640 },
      }),
    ]);
    view.rerender(<InstituteExportsTab instituteId={INSTITUTE_ID} institute={CBSE_INSTITUTE} />);

    expect(screen.queryByTestId(ids.exportProgress('UDISE_DCF'))).not.toBeInTheDocument();
    expect(screen.getByTestId(ids.exportDownloadBtn('UDISE_DCF'))).toBeInTheDocument();
    expect(screen.getByText('Ready · 1,240 records')).toBeInTheDocument();
    expect(state.stopPolling).toHaveBeenCalled();
    expect(screen.getByTestId(ids.exportsHistoryDownloadBtn('report-1'))).toBeInTheDocument();
    expect(screen.getByText('47.5 KB')).toBeInTheDocument();
  });

  it('should show a queued export as waiting to start', () => {
    setHistory([report({ status: 'PENDING' })]);
    renderTab();

    expect(screen.getByTestId(ids.exportProgress('UDISE_DCF'))).toHaveTextContent(
      'Waiting to start…',
    );
  });

  it('should translate the error code of a failed export, never showing it raw', () => {
    setHistory([
      report({ status: 'FAILED', errorCode: 'EXPORT_GENERATION_FAILED' }),
      report({
        id: 'report-2',
        reportType: 'AWR',
        status: 'FAILED',
        errorCode: 'SOMETHING_NEW',
      }),
    ]);
    renderTab();

    expect(screen.getByTestId(ids.exportError('UDISE_DCF'))).toHaveTextContent(
      'The export could not be built. Try again; if it fails again, contact support.',
    );
    expect(screen.getByTestId(ids.exportError('AWR'))).toHaveTextContent(
      'Something went wrong. Try again.',
    );
    expect(screen.queryByText('EXPORT_GENERATION_FAILED')).not.toBeInTheDocument();
  });

  it('should only show a card’s export for the chosen academic year', () => {
    setHistory([report({ academicYearId: OLD_YEAR_ID, status: 'RUNNING' })]);
    renderTab();

    expect(screen.queryByTestId(ids.exportProgress('UDISE_DCF'))).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId(ids.exportCard('UDISE_DCF'))).getByText(
        'Not generated for this year yet.',
      ),
    ).toBeInTheDocument();
  });

  it('should toast a translated reason when the export cannot be started', async () => {
    state.requestExport.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [{ message: 'raw server text', extensions: { code: 'EXPORT_START_FAILED' } }],
      }),
    );
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByTestId(ids.exportGenerateBtn('AWR')));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not start the export', {
        description: 'The export could not be started. Try again in a few minutes.',
      }),
    );
  });

  it('should hide Generate from a user who can read exports but not create them', () => {
    setHistory([
      report({
        status: 'COMPLETED',
        rowCount: 3,
        completedAt: '2026-11-20T05:31:00.000Z',
        file: { id: 'file-1', sizeBytes: 2048 },
      }),
    ]);
    renderTab(CBSE_INSTITUTE, [{ action: 'read', subject: 'Export' }]);

    expect(screen.queryByTestId(ids.exportGenerateBtn('UDISE_DCF'))).not.toBeInTheDocument();
    expect(screen.getByTestId(ids.exportDownloadBtn('UDISE_DCF'))).toBeInTheDocument();
  });

  it('should show the empty history state when nothing was exported yet', () => {
    renderTab();

    expect(screen.getByTestId(ids.exportsHistoryEmpty)).toHaveTextContent('No exports yet');
    expect(screen.queryByTestId(ids.exportsHistoryTable)).not.toBeInTheDocument();
    expect(state.startPolling).not.toHaveBeenCalled();
  });

  it('should show skeletons while the history loads', () => {
    state.history = { data: undefined, loading: true, error: undefined };
    renderTab();

    expect(screen.getByTestId(ids.exportsHistoryLoading)).toBeInTheDocument();
  });

  it('should offer a retry when the history fails to load', async () => {
    state.history = { data: undefined, loading: false, error: new Error('network down') };
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByTestId(ids.exportsHistoryRetry));

    expect(screen.getByTestId(ids.exportsHistoryError)).toHaveTextContent(
      'Past exports could not be loaded.',
    );
    expect(state.refetch).toHaveBeenCalled();
  });

  it('should say so and offer no Generate when the institute has no academic year', () => {
    state.years = {
      data: { adminListExportAcademicYears: [] },
      loading: false,
      error: undefined,
    };
    renderTab();

    expect(screen.getByTestId(ids.exportsNoYears)).toBeInTheDocument();
    expect(screen.queryByTestId(ids.exportGenerateBtn('UDISE_DCF'))).not.toBeInTheDocument();
  });

  it('should show a loading state on the cards, not "not generated", while history loads', () => {
    state.history = { data: undefined, loading: true, error: undefined };
    renderTab();

    const card = screen.getByTestId(ids.exportCard('UDISE_DCF'));
    expect(within(card).getByTestId(ids.exportCardLoading('UDISE_DCF'))).toBeInTheDocument();
    expect(within(card).queryByText('Not generated for this year yet.')).not.toBeInTheDocument();
    expect(within(card).getByTestId(ids.exportGenerateBtn('UDISE_DCF'))).toBeDisabled();
  });

  it('should show why a past export failed as visible text in the history', () => {
    setHistory([report({ status: 'FAILED', errorCode: 'EXPORT_TIMED_OUT' })]);
    renderTab();

    expect(screen.getByTestId(ids.exportsHistoryRowError('report-1'))).toHaveTextContent(
      'The export took too long and was stopped. Generate it again.',
    );
  });

  it('should stop polling and re-enable Generate once a lost export is marked timed out', () => {
    setHistory([report({ status: 'RUNNING' })]);
    const view = renderTab();
    expect(screen.getByTestId(ids.exportGenerateBtn('UDISE_DCF'))).toBeDisabled();
    expect(state.startPolling).toHaveBeenCalledWith(EXPORT_POLL_INTERVAL_MS);

    state.stopPolling.mockReset();
    setHistory([
      report({
        status: 'FAILED',
        errorCode: 'EXPORT_TIMED_OUT',
        completedAt: '2026-11-20T06:10:00.000Z',
      }),
    ]);
    view.rerender(<InstituteExportsTab instituteId={INSTITUTE_ID} institute={CBSE_INSTITUTE} />);

    expect(state.stopPolling).toHaveBeenCalled();
    expect(screen.getByTestId(ids.exportGenerateBtn('UDISE_DCF'))).toBeEnabled();
    expect(screen.getByTestId(ids.exportError('UDISE_DCF'))).toHaveTextContent(
      'The export took too long and was stopped. Generate it again.',
    );
  });

  it('should render in Hindi', () => {
    renderWithProviders(
      <InstituteExportsTab instituteId={INSTITUTE_ID} institute={CBSE_INSTITUTE} />,
      { locale: 'hi' },
    );

    expect(screen.getByText('अनुपालन एक्सपोर्ट')).toBeInTheDocument();
  });
});
