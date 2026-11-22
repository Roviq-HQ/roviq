import type { CreateSectionData, SectionRecord, UpdateSectionData } from './types';

export abstract class SectionRepository {
  abstract searchByName(query: string): Promise<SectionRecord[]>;
  abstract findById(id: string): Promise<SectionRecord | null>;
  abstract findByStandard(standardId: string): Promise<SectionRecord[]>;
  abstract findByAcademicYear(academicYearId: string): Promise<SectionRecord[]>;
  abstract create(data: CreateSectionData): Promise<SectionRecord>;
  abstract update(id: string, data: UpdateSectionData): Promise<SectionRecord>;
  /** Throws SECTION_HAS_STUDENTS while a live student record points at the section. */
  abstract softDelete(id: string): Promise<void>;
}
