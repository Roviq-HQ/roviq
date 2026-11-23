/**
 * ROV-322 — the "Not placed in this year" list filter and its row action.
 */
import type { RawRuleOf } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import { AcademicStatus, Gender, SocialCategory } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messagesEn from '../../../../../../../../messages/en/students.json';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

const { instituteStudents: ids } = testIds;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/people/students',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

// Same tuple per parsers object, so effects depending on the setter do not loop.
vi.mock('nuqs', () => {
  const cache = new WeakMap<object, [Record<string, unknown>, ReturnType<typeof vi.fn>]>();
  return {
    useQueryStates: (parsers: Record<string, unknown>) => {
      let entry = cache.get(parsers);
      if (!entry) {
        const defaults: Record<string, unknown> = {};
        for (const key of Object.keys(parsers)) {
          defaults[key] = key === 'size' ? 25 : key === 'notPlaced' ? true : null;
        }
        entry = [defaults, vi.fn()];
        cache.set(parsers, entry);
      }
      return entry;
    },
    parseAsString: { withDefault: () => ({}) },
    parseAsInteger: { withDefault: () => ({}) },
    parseAsBoolean: { withDefault: () => ({}) },
    parseAsArrayOf: () => ({ withDefault: () => ({}) }),
    parseAsStringEnum: () => ({ withDefault: () => ({}) }),
  };
});

const skippedStudent = {
  id: 'stu-1',
  admissionNumber: 'ADM-001',
  firstName: { en: 'Rajesh' },
  lastName: { en: 'Kumar' },
  gender: Gender.MALE,
  socialCategory: SocialCategory.GENERAL,
  academicStatus: AcademicStatus.ENROLLED,
  isRteAdmitted: false,
  currentStudentAcademicId: 'sa-old',
  currentStandardId: 'std-5-old',
  currentSectionId: 'sec-5a-old',
  currentStandardName: { en: 'Class 5' },
  currentSectionName: { en: 'A' },
  primaryGuardianFirstName: null,
  primaryGuardianLastName: null,
  admissionDate: '2025-04-01',
  createdAt: '2025-04-01T00:00:00Z',
  updatedAt: '2025-04-01T00:00:00Z',
  version: 1,
  promotionStatus: null,
};

const useStudentsMock = vi.fn();

vi.mock('../use-students', () => ({
  useStudents: (...args: unknown[]) => {
    useStudentsMock(...args);
    return {
      students: [skippedStudent],
      totalCount: 1,
      hasNextPage: false,
      loading: false,
      refetch: vi.fn(),
    };
  },
  useStudentsInTenantUpdated: vi.fn(),
  useAcademicYearsForStudents: () => ({
    data: {
      academicYears: [
        { id: 'year-2025', label: '2025-26', isActive: false },
        { id: 'year-2026', label: '2026-27', isActive: true },
      ],
    },
  }),
  useStandardsForYear: () => ({ data: { standards: [] } }),
  useSectionsForStandard: () => ({ data: { sections: [] } }),
  useStudentsExport: () => [vi.fn(async () => ({ data: undefined })), { loading: false }],
  useUpdateStudentSection: () => [vi.fn(), { loading: false }],
  useSetPromotionDecisions: () => [vi.fn(), { loading: false }],
  useEnrollStudent: () => [vi.fn(), { loading: false }],
}));

vi.mock('@web/app/[locale]/institute/(dashboard)/academics/use-academics', () => ({
  useStandards: () => ({ standards: [] }),
  useSections: () => ({ sections: [] }),
}));

import StudentsPage from '../page';

function renderPage(abilityRules?: RawRuleOf<AppAbility>[]) {
  return renderWithProviders(<StudentsPage />, {
    messages: { students: messagesEn },
    abilityRules,
  });
}

describe('StudentsPage — not placed in this year', () => {
  beforeEach(() => {
    useStudentsMock.mockReset();
  });

  it('should ask for students not placed in the selected year instead of that year’s roster', () => {
    renderPage();

    expect(useStudentsMock).toHaveBeenLastCalledWith(
      { first: 25, notPlacedInYearId: 'year-2026' },
      { skip: false },
    );
    expect(screen.getByTestId(ids.notPlacedFilter)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(messagesEn.placement.lastPlacement).length).toBeGreaterThan(0);
  });

  it('should offer Enrol in this year on each row and open the dialog for that student', async () => {
    renderPage();

    await userEvent.click(screen.getAllByTestId(ids.enrolRowBtn('stu-1'))[0]);

    const dialog = await screen.findByTestId(ids.enrolDialog);
    expect(dialog).toHaveTextContent('Enrol in 2026-27');
    expect(dialog).toHaveTextContent('Choose a class and section for Rajesh Kumar.');
  });

  it('should hide the row action from a user who cannot create students', () => {
    renderPage([{ action: 'read', subject: 'Student' }]);

    expect(screen.queryByTestId(ids.enrolRowBtn('stu-1'))).not.toBeInTheDocument();
  });
});
