import type { InstituteStatus } from '@roviq/database';
import type {
  CreateInstituteData,
  DeletedInstituteRecord,
  InstituteRecord,
  InstituteSearchParams,
  InstituteStatistics,
  UpdateInstituteOwnershipData,
} from './types';

export abstract class InstituteRepository {
  abstract searchByName(query: string): Promise<InstituteRecord[]>;
  abstract findById(id: string): Promise<InstituteRecord | null>;
  abstract findByIdIncludeDeleted(id: string): Promise<InstituteRecord | null>;
  abstract search(
    params: InstituteSearchParams,
  ): Promise<{ records: InstituteRecord[]; total: number }>;
  abstract create(data: CreateInstituteData): Promise<InstituteRecord>;
  abstract updateStatus(id: string, status: InstituteStatus): Promise<InstituteRecord>;
  /** Platform-admin only: reassign reseller and/or institute group. `null` removes assignment. */
  abstract updateOwnership(
    id: string,
    data: UpdateInstituteOwnershipData,
  ): Promise<InstituteRecord>;
  abstract softDelete(id: string): Promise<void>;
  abstract restore(id: string): Promise<InstituteRecord>;
  /** Soft-deleted institutes, most recently deleted first (at most 200). */
  abstract listDeleted(): Promise<DeletedInstituteRecord[]>;
  abstract searchByReseller(
    resellerId: string,
    params: InstituteSearchParams,
  ): Promise<{ records: InstituteRecord[]; total: number }>;
  abstract findByReseller(resellerId: string, id: string): Promise<InstituteRecord | null>;
  abstract statisticsByReseller(
    resellerId: string,
  ): Promise<{ totalInstitutes: number; byStatus: Array<{ key: string; count: number }> }>;

  /** Platform-wide institute statistics (admin scope). */
  abstract statistics(): Promise<InstituteStatistics>;
}
