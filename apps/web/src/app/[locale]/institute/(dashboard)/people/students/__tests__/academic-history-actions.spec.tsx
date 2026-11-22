/**
 * ROV-322 — Change class, Remove from this year and Enrol in this year on the student page.
 */
import type { RawRuleOf } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import { AcademicStatus, AdmissionType, Gender, SocialCategory } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import messagesEn from '@web-messages/en/students.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { instituteStudents: ids } = testIds;

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: 'stu-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/people/students/stu-1',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

const student = {
  id: 'stu-1',
  admissionNumber: 'ADM-0001',
  firstName: { en: 'Rajesh' },
  lastName: { en: 'Kumar' },
  gender: Gender.MALE,
  dateOfBirth: '2010-05-10',
  admissionDate: '2025-04-01',
  admissionType: AdmissionType.NEW,
  academicStatus: AcademicStatus.ENROLLED,
  socialCategory: SocialCategory.GENERAL,
  isMinority: false,
  isBpl: false,
  isCwsn: false,
  isRteAdmitted: false,
  tcIssued: false,
  currentStudentAcademicId: 'sa-2026',
  currentStandardId: 'std-6',
  currentSectionId: 'sec-6a',
  createdAt: '2025-04-01T00:00:00Z',
  updatedAt: '2025-04-01T00:00:00Z',
  version: 1,
};

const history = (id: string, academicYearId: string, label: string, isCurrentYear: boolean) => ({
  id,
  studentProfileId: 'stu-1',
  academicYearId,
  academicYearLabel: label,
  isCurrentYear,
  standardId: `std-${label}`,
  standardName: { en: 'Class 6' },
  sectionId: `sec-${label}`,
  sectionName: { en: 'A' },
  rollNumber: null,
  promotionStatus: null,
  createdAt: '2025-04-01T00:00:00Z',
  updatedAt: '2025-04-01T00:00:00Z',
});

const academicsRef: { current: ReturnType<typeof history>[] } = { current: [] };

vi.mock('../use-students', () => ({
  useStudent: () => ({ data: { getStudent: student }, loading: false, error: undefined }),
  useStudentAcademics: () => ({
    data: { listStudentAcademics: academicsRef.current },
    loading: false,
  }),
  useAcademicYearsForStudents: () => ({
    data: {
      academicYears: [
        { id: 'year-2025', label: '2025-26', isActive: false },
        { id: 'year-2026', label: '2026-27', isActive: true },
      ],
    },
  }),
  useStudentAudit: () => ({ data: { auditLogs: { edges: [], totalCount: 0 } }, loading: false }),
  useStudentDocuments: () => ({ data: { listStudentDocuments: [] }, loading: false }),
  useStudentGuardians: () => ({ data: { listStudentGuardians: [] }, loading: false }),
  useStudentTCs: () => ({ data: { listTCs: [] }, loading: false }),
  useUpdateStudent: () => [vi.fn(), { loading: false }],
  useUploadStudentDocument: () => [vi.fn(), { loading: false }],
  useGuardiansForStudentPicker: () => ({ data: { listGuardians: [] }, loading: false }),
  useEnrollStudent: () => [vi.fn(), { loading: false }],
  useChangeStudentClass: () => [vi.fn(), { loading: false }],
  useRemoveStudentFromYear: () => [vi.fn(), { loading: false }],
}));

vi.mock('../../guardians/use-guardians', () => ({
  useLinkGuardianToStudent: () => [vi.fn(), { loading: false }],
}));

vi.mock('@web/hooks/use-form-draft', () => ({
  useFormDraft: () => ({
    hasDraft: false,
    restoreDraft: vi.fn(),
    discardDraft: vi.fn(),
    saveDraft: vi.fn(),
    clearDraft: vi.fn(),
    storedDraft: null,
  }),
}));

vi.mock('@web/app/[locale]/institute/(dashboard)/academics/use-academics', () => ({
  useStandards: () => ({ standards: [] }),
  useSections: () => ({ sections: [] }),
}));

vi.mock('../../../../../../../hooks/use-media-query', () => ({
  useMediaQuery: () => false,
}));

import StudentDetailPage from '../[id]/page';

async function openAcademics(abilityRules?: RawRuleOf<AppAbility>[]) {
  renderWithProviders(<StudentDetailPage />, {
    messages: { students: messagesEn },
    abilityRules,
  });
  await userEvent.click(
    screen.getByRole('tab', { name: new RegExp(messagesEn.detail.tabs.academics, 'i') }),
  );
}

describe('StudentDetailPage › academic history actions', () => {
  beforeEach(() => {
    academicsRef.current = [
      history('sa-2026', 'year-2026', '2026-27', true),
      history('sa-2025', 'year-2025', '2025-26', false),
    ];
  });

  it('should offer Change class and Remove only once, on the active year', async () => {
    await openAcademics();

    expect(screen.getAllByTestId(ids.detailChangeClassBtn)).toHaveLength(1);
    expect(screen.getAllByTestId(ids.detailRemoveFromYearBtn)).toHaveLength(1);
    expect(screen.queryByTestId(ids.detailEnrolBtn)).not.toBeInTheDocument();
  });

  it('should open the change-class and remove dialogs', async () => {
    await openAcademics();

    await userEvent.click(screen.getByTestId(ids.detailChangeClassBtn));
    expect(await screen.findByTestId(ids.changeClassDialog)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByTestId(ids.detailRemoveFromYearBtn));
    expect(await screen.findByTestId(ids.removeFromYearDialog)).toHaveTextContent(
      'Remove from 2026-27?',
    );
  });

  it('should hide Change class and Remove without update Student', async () => {
    await openAcademics([
      { action: 'read', subject: 'Student' },
      { action: 'create', subject: 'Student' },
    ]);

    expect(screen.queryByTestId(ids.detailChangeClassBtn)).not.toBeInTheDocument();
    expect(screen.queryByTestId(ids.detailRemoveFromYearBtn)).not.toBeInTheDocument();
  });

  it('should offer Enrol in this year when the student has no row in the active year', async () => {
    academicsRef.current = [history('sa-2025', 'year-2025', '2025-26', false)];
    await openAcademics();

    expect(screen.getByText('Not placed in 2026-27')).toBeInTheDocument();
    expect(screen.queryByTestId(ids.detailChangeClassBtn)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId(ids.detailEnrolBtn));
    expect(await screen.findByTestId(ids.enrolDialog)).toHaveTextContent('Enrol in 2026-27');
  });

  it('should hide Enrol in this year without create Student', async () => {
    academicsRef.current = [history('sa-2025', 'year-2025', '2025-26', false)];
    await openAcademics([
      { action: 'read', subject: 'Student' },
      { action: 'update', subject: 'Student' },
    ]);

    expect(screen.queryByTestId(ids.detailEnrolBtn)).not.toBeInTheDocument();
  });
});
