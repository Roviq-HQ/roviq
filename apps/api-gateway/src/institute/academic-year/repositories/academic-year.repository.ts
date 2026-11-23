import type { InstituteType } from '@roviq/common-types';
import type { AcademicYearStatus } from '@roviq/database';
import type { YearRolloverCounts } from '../../student/year-rollover';
import type { AcademicYearRecord, CreateAcademicYearData, UpdateAcademicYearData } from './types';

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
  /** Counts what activating `targetYearId` would do to students of the active year; writes nothing. */
  abstract previewRollover(targetYearId: string): Promise<YearRolloverCounts>;
  /** The institute's type, or null when the tenant has no institute row. */
  abstract findInstituteType(tenantId: string): Promise<InstituteType | null>;
}
