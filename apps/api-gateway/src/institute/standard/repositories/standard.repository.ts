import type {
  CreateStandardData,
  CreateStandardResult,
  StandardRecord,
  UpdateStandardData,
} from './types';

export abstract class StandardRepository {
  abstract findById(id: string): Promise<StandardRecord | null>;
  abstract findByAcademicYear(academicYearId: string): Promise<StandardRecord[]>;
  /** Reads the academic year under the caller's institute before the insert. */
  abstract create(data: CreateStandardData): Promise<CreateStandardResult>;
  abstract update(id: string, data: UpdateStandardData): Promise<StandardRecord>;
  abstract softDelete(id: string): Promise<void>;
}
