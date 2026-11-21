/**
 * TC detail page: clearances arrive as `[{ department, cleared }]` and every TcStatus the API
 * can return has copy in both locales (the provider throws on a missing message).
 */
import { TC_STATUS_VALUES, type TcStatus } from '@roviq/common-types';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

const tcState = vi.hoisted(() => ({ status: 'GENERATED' }));

function tcNode(status: string) {
  return {
    id: 'tc-1',
    tcSerialNumber: 'TC/2026/001',
    status,
    reason: 'Family relocated to another city',
    isDuplicate: false,
    isCounterSigned: false,
    originalTcId: null,
    pdfUrl: null,
    qrVerificationUrl: null,
    academicYearId: 'year-1',
    studentProfileId: 'student-1',
    studentFirstName: { en: 'Asha' },
    studentLastName: null,
    currentStandardName: null,
    clearances: [
      { department: 'accounts', cleared: true, by: null, at: '2026-11-20T10:00:00Z', notes: null },
      { department: 'library', cleared: false, by: null, at: null, notes: 'Two books due' },
    ],
    tcData: null,
    createdAt: '2026-11-20T09:00:00Z',
  };
}

const mutation: [ReturnType<typeof vi.fn>, { loading: boolean }] = [vi.fn(), { loading: false }];
vi.mock('../use-certificates', () => ({
  useTC: () => ({ data: { getTCDetails: tcNode(tcState.status) }, loading: false }),
  useApproveTC: () => mutation,
  useIssueTC: () => mutation,
  useRejectTC: () => mutation,
  useRequestDuplicateTC: () => mutation,
}));

import TCDetailPage from '../tc/[id]/page';

describe('TCDetailPage (component)', () => {
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
