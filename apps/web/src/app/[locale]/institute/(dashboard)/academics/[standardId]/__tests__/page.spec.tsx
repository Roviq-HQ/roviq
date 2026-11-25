import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { RawRuleOf } from '@casl/ability';
import { type AppAbility, GenderRestriction } from '@roviq/common-types';
import { TooltipProvider } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import type { Section } from '../../use-academics';

const { instituteAcademics: ids } = testIds;

// next-intl 4.x calls `getRedirectFn(redirect)` at module init, so `redirect` & co. must exist.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en', standardId: 'std-6' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/academics/std-6',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

const setYear = vi.fn();
vi.mock('nuqs', () => ({
  useQueryState: () => [null, setYear],
  parseAsString: {},
}));

const deleteSectionMock = vi.fn();
const createSectionMock = vi.fn();
const createSubjectMock = vi.fn();
const sectionsState: { sections: Section[] } = { sections: [] };

vi.mock('../../use-academics', () => ({
  useStandards: () => ({ standards: [], loading: false, error: undefined, refetch: vi.fn() }),
  useSections: () => ({
    sections: sectionsState.sections,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  useSubjectsByStandard: () => ({
    subjects: [],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  useCreateSection: () => ({ createSection: createSectionMock, loading: false }),
  useCreateSubject: () => ({ createSubject: createSubjectMock, loading: false }),
  useDeleteSection: () => ({ deleteSection: deleteSectionMock, loading: false }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import StandardDetailPage from '../page';

function section(id: string, name: string): Section {
  return {
    __typename: 'SectionModel',
    id,
    name: { en: name },
    displayLabel: `6-${name}`,
    displayOrder: 1,
    standardId: 'std-6',
    academicYearId: 'year-2026',
    batchStatus: null,
    capacity: 40,
    classTeacherId: null,
    currentStrength: 12,
    endTime: null,
    startTime: null,
    genderRestriction: GenderRestriction.CO_ED,
    mediumOfInstruction: null,
    room: null,
    shift: null,
    stream: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

const SECTION_B = section('sec-b', 'B');

function renderPage(abilityRules?: RawRuleOf<AppAbility>[]) {
  // The app's root providers supply TooltipProvider; CapacityBar needs it.
  return renderWithProviders(
    <TooltipProvider>
      <StandardDetailPage />
    </TooltipProvider>,
    { abilityRules },
  );
}

async function openDeleteDialog() {
  renderPage();
  await userEvent.click(screen.getByTestId(ids.sectionDeleteBtn(SECTION_B.id)));
  return screen.findByTestId(ids.sectionDeleteDialog);
}

describe('StandardDetailPage section delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteSectionMock.mockReset();
    sectionsState.sections = [SECTION_B];
  });

  it('should show the delete button to a user who can delete Section', () => {
    renderPage([
      { action: 'read', subject: 'Standard' },
      { action: 'delete', subject: 'Section' },
    ]);

    expect(screen.getByTestId(ids.sectionDeleteBtn(SECTION_B.id))).toHaveAccessibleName(
      'Delete Section',
    );
  });

  it('should hide the delete button without delete Section', () => {
    renderPage([{ action: 'read', subject: 'Standard' }]);

    expect(screen.getByTestId(ids.sectionsTable)).toBeInTheDocument();
    expect(screen.queryByTestId(ids.sectionDeleteBtn(SECTION_B.id))).toBeNull();
  });

  it('should delete the section on confirm and close the dialog', async () => {
    deleteSectionMock.mockResolvedValue({ data: { deleteSection: true } });
    const dialog = await openDeleteDialog();
    expect(within(dialog).getByText('Delete B?')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId(ids.sectionDeleteConfirmBtn));

    expect(deleteSectionMock).toHaveBeenCalledWith(SECTION_B.id);
    expect(toast.success).toHaveBeenCalledWith('Deleted successfully');
    expect(screen.queryByTestId(ids.sectionDeleteDialog)).toBeNull();
  });

  it('should show the translated SECTION_HAS_STUDENTS message and keep the row', async () => {
    deleteSectionMock.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [{ message: 'raw server text', extensions: { code: 'SECTION_HAS_STUDENTS' } }],
      }),
    );
    await openDeleteDialog();

    await userEvent.click(screen.getByTestId(ids.sectionDeleteConfirmBtn));

    expect(toast.error).toHaveBeenCalledWith(
      'This section still has students. Move them to another section before deleting it.',
    );
    expect(toast.error).not.toHaveBeenCalledWith('raw server text');
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId(ids.sectionDeleteDialog)).toBeInTheDocument();
    expect(
      within(screen.getByTestId(ids.sectionsTable)).getByText(SECTION_B.displayLabel ?? ''),
    ).toBeInTheDocument();
  });
});

describe('StandardDetailPage subject create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSubjectMock.mockReset();
    sectionsState.sections = [SECTION_B];
  });

  it('should link the new subject to the class it is created from', async () => {
    createSubjectMock.mockResolvedValue({ data: { createSubject: { id: 'sub-1' } } });
    renderPage();
    await userEvent.click(screen.getByTestId(ids.standardSubjectsTab));
    await userEvent.click(screen.getByTestId(ids.subjectNewBtn));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Rhymes');
    await userEvent.click(within(dialog).getByRole('button', { name: 'New Subject' }));

    expect(createSubjectMock).toHaveBeenCalledWith({
      name: 'Rhymes',
      shortName: undefined,
      boardCode: undefined,
      type: 'ACADEMIC',
      isMandatory: false,
      hasPractical: false,
      isElective: false,
      theoryMarks: 80,
      practicalMarks: 0,
      internalMarks: 20,
      electiveGroup: undefined,
      standardIds: ['std-6'],
    });
    expect(toast.success).toHaveBeenCalledWith('Created successfully');
  });
});

describe('StandardDetailPage section create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSectionMock.mockReset();
    sectionsState.sections = [SECTION_B];
  });

  async function openCreateDialog() {
    renderPage();
    await userEvent.click(screen.getByTestId(ids.sectionNewBtn));
    return screen.findByRole('dialog');
  }

  it('should ask for a name when the name is empty, not report it as taken', async () => {
    const dialog = await openCreateDialog();

    await userEvent.click(within(dialog).getByRole('button', { name: 'New Section' }));

    expect(await within(dialog).findByText('Enter a name.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/already/)).toBeNull();
    expect(createSectionMock).not.toHaveBeenCalled();
  });
});
