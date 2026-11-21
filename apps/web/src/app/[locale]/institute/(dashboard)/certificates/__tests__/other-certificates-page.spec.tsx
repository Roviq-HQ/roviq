import { AcademicStatus } from '@roviq/common-types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import messagesEn from '../../../../../../../messages/en/certificates.json';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/certificates/other',
}));

// Stable results: a new object per render would re-fire the dialog's reset effect.
const certificatesResult = { certificates: [], loading: false };
const mutationResult: [ReturnType<typeof vi.fn>, { loading: boolean }] = [
  vi.fn(),
  { loading: false },
];
const emptyQuery = { data: undefined };
const useStudentPickerMock = vi.fn((_search: string, _filter?: unknown) => emptyQuery);
vi.mock('../use-certificates', () => ({
  useCertificates: () => certificatesResult,
  useIssueCertificate: () => mutationResult,
  useRequestCertificate: () => mutationResult,
  usePreviewCertificate: () => mutationResult,
  useCertificateTemplateFields: () => emptyQuery,
  useStudentPicker: (search: string, filter?: unknown) => useStudentPickerMock(search, filter),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import OtherCertificatesPage from '../other/page';

describe('OtherCertificatesPage — issue dialog', () => {
  it('offers only enrolled students, as the TC dialog does', async () => {
    renderWithProviders(<OtherCertificatesPage />, { messages: { certificates: messagesEn } });

    await userEvent.click(
      screen.getByRole('button', {
        name: messagesEn.other.issueButton.replace('{type}', messagesEn.types.BONAFIDE_CERTIFICATE),
      }),
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(useStudentPickerMock).toHaveBeenCalledWith('', {
      academicStatus: [AcademicStatus.ENROLLED],
    });
    expect(useStudentPickerMock).not.toHaveBeenCalledWith('', undefined);
  });
});
