import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { ExaminationRepository } from './repositories/examination.repository';
import type { ExamRefKind, ExamRefs } from './repositories/types';

const REFUSAL: Record<ExamRefKind, [code: ErrorCode, message: string]> = {
  year: [ErrorCode.ACADEMIC_YEAR_NOT_FOUND, 'Academic year not found'],
  term: [ErrorCode.EXAM_TERM_NOT_FOUND, 'Exam term not found'],
  scheme: [ErrorCode.GRADING_SCHEME_NOT_FOUND, 'Grading scheme not found'],
  exam: [ErrorCode.EXAM_NOT_FOUND, 'Exam not found'],
  section: [ErrorCode.SECTION_NOT_FOUND, 'Section not found'],
  subject: [ErrorCode.SUBJECT_NOT_FOUND, 'Subject not found'],
  standard: [ErrorCode.STANDARD_NOT_FOUND, 'Standard not found'],
  membership: [ErrorCode.MEMBERSHIP_NOT_FOUND, 'Invigilator is not a member of this institute'],
  schedule: [ErrorCode.EXAM_SCHEDULE_NOT_FOUND, 'Datesheet row not found'],
  topic: [ErrorCode.NOT_FOUND, 'Subject topic not found'],
  area: [ErrorCode.NOT_FOUND, 'Co-scholastic area not found'],
  student: [ErrorCode.STUDENT_NOT_FOUND, 'Student not found'],
};

/**
 * Refuses a write that names a row the caller's institute does not have. Call before the first
 * write: a foreign key would accept another institute's row.
 */
export async function assertExamRefs(repo: ExaminationRepository, refs: ExamRefs): Promise<void> {
  const missing = await repo.findMissingRef(refs);
  if (missing) throw new BusinessException(...REFUSAL[missing]);
}
