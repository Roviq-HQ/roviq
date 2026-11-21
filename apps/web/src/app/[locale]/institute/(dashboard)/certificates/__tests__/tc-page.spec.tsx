/**
 * ROV-170 — Component tests for the TC list page.
 *
 * Mocks `use-certificates` + nuqs + next/navigation so the spec stays focused
 * on rendering, CASL gating, and the empty state. Real Apollo wiring is
 * covered by the integration + e2e layers.
 */
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { RawRuleOf } from '@casl/ability';
import { type AppAbility, ErrorCode } from '@roviq/common-types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import messagesEn from '../../../../../../../messages/en/certificates.json';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';

// ── next/navigation ──────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/certificates/tc',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

// ── nuqs — static defaults, no URL persistence ───────────
// Cache by parsers reference so each render returns the SAME tuple. Without
// this, `setFilters` is a fresh vi.fn() each call → useEffect deps that
// include setFilters re-fire forever and OOM the worker.
vi.mock('nuqs', () => {
  const cache = new WeakMap<object, [Record<string, unknown>, ReturnType<typeof vi.fn>]>();
  return {
    useQueryStates: (parsers: Record<string, unknown>) => {
      let entry = cache.get(parsers);
      if (!entry) {
        const defaults: Record<string, unknown> = {};
        for (const key of Object.keys(parsers)) {
          defaults[key] = key === 'size' ? 25 : null;
        }
        entry = [defaults, vi.fn()];
        cache.set(parsers, entry);
      }
      return entry;
    },
    parseAsString: { withDefault: () => ({}) },
    parseAsInteger: { withDefault: () => ({}) },
    parseAsArrayOf: () => ({ withDefault: () => ({}) }),
  };
});

// ── use-certificates hook module ─────────────────────────
// Stable references — see nuqs mock note above. New objects each render
// would re-fire the dialog's `[open, yearsData, ...]` effect → reset() loop.
const tcsResult: { tcs: Array<Record<string, unknown>>; loading: boolean; refetch: () => void } = {
  tcs: [],
  loading: false,
  refetch: vi.fn(),
};
const useTCsMock = vi.fn((_filter?: unknown, _options?: { skip?: boolean }) => tcsResult);
const useStudentPickerMock = vi.fn((_search: string, _filter?: unknown) => studentPickerResult);
const requestTCResult: [ReturnType<typeof vi.fn>, { loading: boolean }] = [
  vi.fn(),
  { loading: false },
];
const studentPickerResult = {
  data: {
    listStudents: {
      edges: [
        {
          node: {
            id: 'student-1',
            admissionNumber: 'ADM-1',
            firstName: { en: 'Asha' },
            lastName: null,
            currentStandardName: null,
            currentSectionName: null,
          },
        },
      ],
    },
  },
};
const yearsResult = {
  data: { academicYears: [{ id: 'year-1', label: '2026-27', isActive: true }] },
};
vi.mock('../use-certificates', () => ({
  useTCs: (filter?: unknown, options?: { skip?: boolean }) => useTCsMock(filter, options),
  useRequestTC: () => requestTCResult,
  useStudentPicker: (search: string, filter?: unknown) => useStudentPickerMock(search, filter),
  useAcademicYearsForCertificates: () => yearsResult,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Radix Select uses pointer-capture APIs happy-dom doesn't ship.
if (typeof Element.prototype.hasPointerCapture === 'undefined') {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture === 'undefined') {
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

// Import AFTER mocks.
import TCListPage from '../tc/page';

function renderPage(abilityRules?: RawRuleOf<AppAbility>[]) {
  return renderWithProviders(<TCListPage />, {
    messages: { certificates: messagesEn },
    abilityRules,
  });
}

describe('TCListPage (component)', () => {
  it('renders the TC page title and description', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/transfer certificate/i);
  });

  it('renders the empty state when the tenant has no TCs', () => {
    renderPage();
    // The "no data" empty state title must appear from the certificates namespace.
    expect(screen.getAllByText(/no .*transfer certificate/i).length).toBeGreaterThan(0);
  });

  it('shows the no-permission state, without querying, when the user lacks TC read permission', () => {
    renderPage([{ action: 'read', subject: 'Student' }]);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText(messagesEn.tc.accessDenied.title)).toBeInTheDocument();
    expect(useTCsMock).toHaveBeenLastCalledWith({}, { skip: true });
  });

  it('shows the class name of each TC', () => {
    tcsResult.tcs = [
      {
        id: 'tc-1',
        tcSerialNumber: 'TC/2026-27/0001',
        status: 'GENERATED',
        reason: 'Family relocated to another city',
        isDuplicate: false,
        studentFirstName: { en: 'Asha' },
        studentLastName: null,
        standardName: { en: 'Class 5', hi: 'कक्षा 5' },
        createdAt: '2026-11-20T09:00:00Z',
      },
    ];
    try {
      renderPage();
      const row = screen.getByRole('row', { name: /TC\/2026-27\/0001/ });
      expect(within(row).getByText('Class 5')).toBeInTheDocument();
    } finally {
      tcsResult.tcs = [];
    }
  });

  it('explains a duplicate TC request in translated copy instead of the server message', async () => {
    const user = userEvent.setup();
    requestTCResult[0].mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [
          { message: 'raw server text', extensions: { code: ErrorCode.TC_ALREADY_REQUESTED } },
        ],
      }),
    );
    renderPage();

    await user.click(screen.getByRole('button', { name: messagesEn.tc.requestButton }));
    const dialog = await screen.findByRole('dialog');
    // A TC is only for an enrolled student, so the picker never offers anyone else.
    expect(useStudentPickerMock).toHaveBeenCalledWith('', { academicStatus: ['ENROLLED'] });
    const studentTrigger = within(dialog).getAllByRole('combobox')[0];
    if (!studentTrigger) throw new Error('student select not found');
    fireEvent.pointerDown(studentTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.pointerUp(studentTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const option = await screen.findByRole('option', { name: 'ADM-1 · Asha' });
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
    await user.click(option);
    await user.type(
      within(dialog).getByLabelText(messagesEn.tc.requestDialog.reasonLabel),
      'Family relocated to another city',
    );
    expect(within(dialog).getByText('32 of 200 characters')).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: messagesEn.tc.requestDialog.submit }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(messagesEn.tc.requestError, {
        description: messagesEn.tc.requestDialog.errors.alreadyRequested,
      }),
    );
    expect(requestTCResult[0]).toHaveBeenCalledWith({
      variables: {
        input: {
          studentProfileId: 'student-1',
          academicYearId: 'year-1',
          reason: 'Family relocated to another city',
        },
      },
    });
  });
});
