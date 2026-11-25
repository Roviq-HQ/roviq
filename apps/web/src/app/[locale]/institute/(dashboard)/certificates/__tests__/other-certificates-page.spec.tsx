import { AcademicStatus } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import messagesEn from '../../../../../../../messages/en/certificates.json';
import messagesHi from '../../../../../../../messages/hi/certificates.json';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/certificates/other',
}));

// Stable results: a new object per render would re-fire the dialog's reset effect.
interface CertificateRow {
  id: string;
  serialNumber: string;
  studentProfileId: string | null;
  studentFirstName: Record<string, string> | null;
  studentLastName: Record<string, string> | null;
  studentAdmissionNumber: string | null;
  purpose: string;
  status: string;
  createdAt: string;
}
const draftCertificate: CertificateRow = {
  id: 'cert-1',
  serialNumber: 'CERT/BON/0001',
  studentProfileId: null,
  studentFirstName: null,
  studentLastName: null,
  studentAdmissionNumber: null,
  purpose: 'Scholarship application',
  status: 'DRAFT',
  createdAt: '2026-11-25T10:00:00.000Z',
};
const certificatesResult: { certificates: CertificateRow[]; loading: boolean } = {
  certificates: [],
  loading: false,
};
const mutationResult: [ReturnType<typeof vi.fn>, { loading: boolean }] = [
  vi.fn(),
  { loading: false },
];
const emptyQuery = { data: undefined };
const useStudentPickerMock = vi.fn((_search: string, _filter?: unknown) => emptyQuery);
const templatesResult = {
  data: {
    listCertificateTemplates: [
      { id: 'tpl-1', name: 'Bonafide (CBSE)', type: 'BONAFIDE_CERTIFICATE' },
      { id: 'tpl-2', name: 'Bonafide (short)', type: 'BONAFIDE_CERTIFICATE' },
    ],
  },
  loading: false,
};
const noTemplatesResult = { data: { listCertificateTemplates: [] }, loading: false };
const useCertificateTemplatesMock = vi.fn(
  (_type: string): typeof templatesResult | typeof noTemplatesResult => templatesResult,
);
vi.mock('../use-certificates', () => ({
  useCertificates: () => certificatesResult,
  useIssueCertificate: () => mutationResult,
  useRequestCertificate: () => mutationResult,
  usePreviewCertificate: () => mutationResult,
  useCertificateTemplateFields: () => emptyQuery,
  useCertificateTemplates: (type: string) => useCertificateTemplatesMock(type),
  useStudentPicker: (search: string, filter?: unknown) => useStudentPickerMock(search, filter),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import OtherCertificatesPage from '../other/page';

async function openBonafideDialog(messages: typeof messagesEn) {
  await userEvent.click(
    screen.getByRole('button', {
      name: messages.other.issueButton.replace('{type}', messages.types.BONAFIDE_CERTIFICATE),
    }),
  );
  return screen.findByRole('dialog');
}

describe('OtherCertificatesPage — certificate list', () => {
  it('labels a draft certificate with its translated status', () => {
    certificatesResult.certificates = [draftCertificate];
    renderWithProviders(<OtherCertificatesPage />, { messages: { certificates: messagesEn } });

    expect(screen.getByText(messagesEn.certificateStatuses.DRAFT)).toBeInTheDocument();
    expect(screen.queryByText('certificates.certificateStatuses.DRAFT')).not.toBeInTheDocument();
    certificatesResult.certificates = [];
  });

  const STUDENT_ID = '01a2b3c4-d5e6-7f80-9a0b-1c2d3e4f5a6b';

  it("shows the student's name and admission number, never a shortened id (ROV-360)", () => {
    certificatesResult.certificates = [
      {
        ...draftCertificate,
        studentProfileId: STUDENT_ID,
        studentFirstName: { en: 'Asha', hi: 'आशा' },
        studentLastName: { en: 'Verma', hi: 'वर्मा' },
        studentAdmissionNumber: 'ADM-0042',
      },
    ];
    renderWithProviders(<OtherCertificatesPage />, { locale: 'hi' });

    const cell = screen.getByTestId(testIds.instituteCertificatesOther.student('cert-1'));
    expect(within(cell).getByRole('button', { name: 'आशा वर्मा' })).toBeInTheDocument();
    expect(cell).toHaveTextContent(
      messagesHi.columns.admissionNumber.replace('{number}', 'ADM-0042'),
    );
    expect(screen.queryByText(new RegExp(STUDENT_ID.slice(0, 8)))).not.toBeInTheDocument();
    certificatesResult.certificates = [];
  });

  it('says "Unknown student" when the student can no longer be read (ROV-360)', () => {
    certificatesResult.certificates = [{ ...draftCertificate, studentProfileId: STUDENT_ID }];
    renderWithProviders(<OtherCertificatesPage />, { messages: { certificates: messagesEn } });

    expect(
      screen.getByTestId(testIds.instituteCertificatesOther.student('cert-1')),
    ).toHaveTextContent(messagesEn.columns.unknownStudent);
    expect(screen.queryByText(new RegExp(STUDENT_ID.slice(0, 8)))).not.toBeInTheDocument();
    certificatesResult.certificates = [];
  });
});

describe('OtherCertificatesPage — issue dialog', () => {
  it("offers the institute's templates of the dialog's type by name", async () => {
    renderWithProviders(<OtherCertificatesPage />, { messages: { certificates: messagesEn } });
    await openBonafideDialog(messagesEn);

    expect(useCertificateTemplatesMock).toHaveBeenCalledWith('BONAFIDE_CERTIFICATE');
    expect(screen.getByText(messagesEn.other.dialog.templateLabel)).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Bonafide (CBSE)', hidden: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Bonafide (short)', hidden: true }),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Paste template UUID')).not.toBeInTheDocument();
  });

  it('says so when the institute has no template of this type', async () => {
    useCertificateTemplatesMock.mockImplementation(() => noTemplatesResult);
    renderWithProviders(<OtherCertificatesPage />, { messages: { certificates: messagesEn } });
    await openBonafideDialog(messagesEn);

    const empty = messagesEn.other.dialog.noTemplates.replace(
      '{type}',
      messagesEn.types.BONAFIDE_CERTIFICATE,
    );
    expect(screen.getByRole('option', { name: empty, hidden: true })).toBeDisabled();
    useCertificateTemplatesMock.mockImplementation(() => templatesResult);
  });

  it('shows the purpose rule in Hindi', async () => {
    renderWithProviders(<OtherCertificatesPage />, {
      locale: 'hi',
      messages: { certificates: messagesHi },
    });
    await openBonafideDialog(messagesHi);

    const purpose = screen.getByLabelText(messagesHi.other.dialog.purposeLabel);
    await userEvent.type(purpose, 'ab');
    await userEvent.tab();

    expect(
      await screen.findByText(messagesHi.other.dialog.errors.purposeRequired),
    ).toBeInTheDocument();
  });

  it('offers only enrolled students, as the TC dialog does', async () => {
    renderWithProviders(<OtherCertificatesPage />, { messages: { certificates: messagesEn } });

    expect(await openBonafideDialog(messagesEn)).toBeInTheDocument();
    expect(useStudentPickerMock).toHaveBeenCalledWith('', {
      academicStatus: [AcademicStatus.ENROLLED],
    });
    expect(useStudentPickerMock).not.toHaveBeenCalledWith('', undefined);
  });
});
