import type { ResellerUserListQuery, ResellerUserListResult } from './types';

export abstract class ResellerUserRepository {
  /**
   * Users with a membership in one of the reseller's institutes, one page oldest first, with
   * their memberships in those institutes. Runs as the reseller, so RLS limits every row.
   */
  abstract list(resellerId: string, query: ResellerUserListQuery): Promise<ResellerUserListResult>;
}
