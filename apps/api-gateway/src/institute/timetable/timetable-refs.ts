import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { TimetableRepository } from './repositories/timetable.repository';
import type { TimetableRefs } from './repositories/types';

/**
 * Refuses a write that names a year, section, subject or teacher the caller's institute does
 * not have. Call before the first write: a foreign key would accept another institute's row.
 */
export async function assertTimetableRefs(
  repo: TimetableRepository,
  refs: TimetableRefs,
): Promise<void> {
  const missing = await repo.findMissingRef(refs);
  if (missing === 'year') {
    throw new BusinessException(ErrorCode.ACADEMIC_YEAR_NOT_FOUND, 'Academic year not found');
  }
  if (missing === 'section') {
    throw new BusinessException(ErrorCode.SECTION_NOT_FOUND, 'Section not found');
  }
  if (missing === 'subject') {
    throw new BusinessException(ErrorCode.SUBJECT_NOT_FOUND, 'Subject not found');
  }
  if (missing === 'teacher') {
    throw new BusinessException(
      ErrorCode.MEMBERSHIP_NOT_FOUND,
      'Teacher is not a member of this institute',
    );
  }
}

/** The period must be of the timetable and the section one it covers. */
export async function assertTimetableCell(
  repo: TimetableRepository,
  cell: { timetableId: string; sectionId: string; periodId: string },
): Promise<void> {
  const sections = await repo.findSections(cell.timetableId);
  if (!sections.some((s) => s.sectionId === cell.sectionId)) {
    throw new BusinessException(
      ErrorCode.TIMETABLE_SECTION_NOT_COVERED,
      'This section is not part of the timetable.',
    );
  }
  const period = await repo.findPeriodById(cell.periodId);
  if (!period || period.timetableId !== cell.timetableId) {
    throw new BusinessException(
      ErrorCode.TIMETABLE_PERIOD_NOT_FOUND,
      `Period ${cell.periodId} not found in this timetable`,
    );
  }
}
