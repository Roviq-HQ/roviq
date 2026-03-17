import type { AcademicYearRecord, CreateAcademicYearData, UpdateAcademicYearData } from './types';

export abstract class AcademicYearRepository {
  abstract findById(id: string): Promise<AcademicYearRecord | null>;
  abstract findAll(): Promise<AcademicYearRecord[]>;
  abstract findActive(): Promise<AcademicYearRecord | null>;
  abstract create(data: CreateAcademicYearData): Promise<AcademicYearRecord>;
  abstract update(id: string, data: UpdateAcademicYearData): Promise<AcademicYearRecord>;
  abstract activate(id: string, previousActiveId: string | null): Promise<AcademicYearRecord>;
  abstract updateStatus(id: string, status: string): Promise<AcademicYearRecord>;
}
