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
  abstract statistics(now: Date): Promise<AdminUserStatisticsRecord>;
}
