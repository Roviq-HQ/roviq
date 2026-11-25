import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it, vi } from 'vitest';
import { Datesheet } from '../page';

const { instituteExaminations: ex } = testIds;

const SUBJECT_ID = '01a2b3c4-0000-7000-8000-0000000000b1';
const MISSING_SUBJECT_ID = '7c1e0000-0000-7000-8000-0000000000b2';

const subjectsState = { loading: false };

vi.mock('../../use-examinations', () => ({
  ASSESSMENT_COMPONENTS: ['THEORY', 'PRACTICAL'],
  useExamDatesheet: () => ({ loading: false }),
  useRemoveExamSchedule: () => ({ removeSchedule: vi.fn() }),
  useAllSubjects: () => ({
    subjects: subjectsState.loading
      ? []
      : [{ id: SUBJECT_ID, name: { en: 'Science', hi: 'विज्ञान' } }],
    loading: subjectsState.loading,
  }),
}));

vi.mock('../../../people/staff/use-staff', () => ({
  useStaff: () => ({ staff: [] }),
}));

function paper(id: string, subjectId: string) {
  return {
    id,
    examId: 'exam-1',
    sectionId: 'sec-1',
    subjectId,
    component: 'THEORY' as const,
    examDate: '2026-04-20',
    startTime: null,
    endTime: null,
    maxMarks: 100,
    passMarks: null,
    room: null,
    invigilatorId: null,
  };
}

function renderDatesheet(locale: 'en' | 'hi' = 'en') {
  return renderWithProviders(
    <Datesheet
      examId="exam-1"
      examStatus="DRAFT"
      academicYearId="ay-1"
      startDate="2026-04-20"
      endDate="2026-04-20"
      schedules={[paper('p-1', SUBJECT_ID), paper('p-2', MISSING_SUBJECT_ID)]}
      designerOpen={false}
      setDesignerOpen={vi.fn()}
    />,
    { locale },
  );
}

describe('Datesheet subject names (ROV-360)', () => {
  it('names each subject, and says "Unknown subject" for one it cannot find', () => {
    renderDatesheet('hi');
    expect(screen.getByTestId(ex.scheduleRow('p-1'))).toHaveTextContent('विज्ञान');
    const missing = screen.getByTestId(ex.scheduleRow('p-2'));
    expect(missing).toHaveTextContent('अज्ञात विषय');
    expect(missing).not.toHaveTextContent(MISSING_SUBJECT_ID.slice(0, 8));
  });

  it('shows neither a fallback nor an id while subjects load', () => {
    subjectsState.loading = true;
    renderDatesheet();
    const row = screen.getByTestId(ex.scheduleRow('p-2'));
    expect(row).not.toHaveTextContent('Unknown subject');
    expect(row).not.toHaveTextContent(MISSING_SUBJECT_ID.slice(0, 8));
    subjectsState.loading = false;
  });
});
