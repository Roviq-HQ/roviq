import type { FileRecord } from '../../../files/repositories/types';
import type {
  AdminUserDetailRecord,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserRecord,
  AdminUserStatisticsRecord,
} from './types';

export abstract class AdminUserRepository {
  abstract list(query: AdminUserListQuery): Promise<AdminUserListResult>;
  abstract search(term: string, limit: number): Promise<AdminUserRecord[]>;
  abstract findDetail(userId: string): Promise<AdminUserDetailRecord | null>;
  /** A READY file that is a page of some user document; null otherwise. */
  abstract findDocumentFile(fileId: string): Promise<FileRecord | null>;
  abstract statistics(now: Date): Promise<AdminUserStatisticsRecord>;
}
