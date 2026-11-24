import type { InstituteType } from '@roviq/common-types';
import type { AcademicYearStatus } from '@roviq/database';
import type {
  AcademicYearRecord,
  CreateAcademicYearData,
  RolloverPreviewRecord,
  RolloverSectionMapEntry,
  SetRolloverSectionMapResult,
  UpdateAcademicYearData,
} from './types';

export abstract class AcademicYearRepository {
  abstract findById(id: string): Promise<AcademicYearRecord | null>;
  abstract findAll(): Promise<AcademicYearRecord[]>;
  abstract findActive(): Promise<AcademicYearRecord | null>;
  /** Find academic years whose date ranges overlap with the given range (excludes the given id) */
  abstract findOverlapping(
    startDate: string,
    endDate: string,
    excludeId?: string,
  ): Promise<AcademicYearRecord[]>;
  abstract create(data: CreateAcademicYearData): Promise<AcademicYearRecord>;
  abstract update(id: string, data: UpdateAcademicYearData): Promise<AcademicYearRecord>;
  abstract activate(id: string, previousActiveId: string | null): Promise<AcademicYearRecord>;
  abstract updateStatus(id: string, status: AcademicYearStatus): Promise<AcademicYearRecord>;
  abstract softDelete(id: string): Promise<void>;
  /** What activating `targetYearId` would do to students of the active year; writes nothing. */
  abstract previewRollover(targetYearId: string): Promise<RolloverPreviewRecord>;
  /**
   * Sets or removes the override of each named section of the active year, after reading the
   * year and every section under the caller's institute. Nothing is written unless all pass.
   */
  abstract setRolloverSectionMap(
    targetYearId: string,
    entries: RolloverSectionMapEntry[],
  ): Promise<SetRolloverSectionMapResult>;
  /** The institute's type, or null when the tenant has no institute row. */
  abstract findInstituteType(tenantId: string): Promise<InstituteType | null>;
}
