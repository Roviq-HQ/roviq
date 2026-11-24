import type {
  CreateSectionData,
  SectionRecord,
  SectionWriteResult,
  UpdateSectionData,
} from './types';

export abstract class SectionRepository {
  abstract searchByName(query: string): Promise<SectionRecord[]>;
  abstract findById(id: string): Promise<SectionRecord | null>;
  abstract findByStandard(standardId: string): Promise<SectionRecord[]>;
  abstract findByAcademicYear(academicYearId: string): Promise<SectionRecord[]>;
  /**
   * Reads the year, the standard (which must be of that year) and the class teacher under the
   * caller's institute before the insert.
   */
  abstract create(data: CreateSectionData): Promise<SectionWriteResult>;
  /** Reads a new class teacher under the caller's institute before the update. */
  abstract update(id: string, data: UpdateSectionData): Promise<SectionWriteResult>;
  /** Throws SECTION_HAS_STUDENTS while a live student record points at the section. */
  abstract softDelete(id: string): Promise<void>;
}
