import type {
  CreateSubjectData,
  CreateSubjectResult,
  SubjectLinkResult,
  SubjectNameOption,
  SubjectRecord,
  UpdateSubjectData,
} from './types';

export abstract class SubjectRepository {
  abstract findById(id: string): Promise<SubjectRecord | null>;
  abstract findAll(): Promise<SubjectRecord[]>;
  abstract findByStandard(standardId: string): Promise<SubjectRecord[]>;
  abstract findByAcademicYear(academicYearId: string): Promise<SubjectNameOption[]>;
  /** Reads every standard and section id under the caller's institute before any insert. */
  abstract create(data: CreateSubjectData): Promise<CreateSubjectResult>;
  abstract update(id: string, data: UpdateSubjectData): Promise<SubjectRecord>;
  abstract softDelete(id: string): Promise<void>;
  /** The four link methods read both ids under the caller's institute before writing. */
  abstract assignToStandard(subjectId: string, standardId: string): Promise<SubjectLinkResult>;
  abstract removeFromStandard(subjectId: string, standardId: string): Promise<SubjectLinkResult>;
  abstract assignToSection(subjectId: string, sectionId: string): Promise<SubjectLinkResult>;
  abstract removeFromSection(subjectId: string, sectionId: string): Promise<SubjectLinkResult>;
}
