import type { I18nContent } from '@roviq/database';
import type { DlqListQuery, DlqMessageRecord, DlqTransitionResult } from './types';

export interface DlqStreamCount {
  originStream: string;
  count: number;
}

export abstract class DlqRepository {
  /** Matching rows newest first, and the count of every row the filters match. */
  abstract list(query: DlqListQuery): Promise<{ records: DlqMessageRecord[]; totalCount: number }>;
  abstract countPending(): Promise<number>;
  /** Names of the given institutes; a deleted institute is missing from the map. */
  abstract findInstituteNames(tenantIds: readonly string[]): Promise<Map<string, I18nContent>>;
  /** Rows written since `since`, per origin stream. */
  abstract countSinceByStream(since: Date): Promise<DlqStreamCount[]>;
  /**
   * In one transaction: reads the row, runs `beforeUpdate` (which may throw to
   * roll back), then marks it replayed. `beforeUpdate` holds the rule and the
   * publish so a failed publish leaves the row untouched.
   */
  abstract replay(
    id: string,
    replayedBy: string,
    beforeUpdate: (row: DlqMessageRecord) => Promise<void>,
  ): Promise<DlqTransitionResult>;
  /** In one transaction: reads the row, runs `beforeUpdate`, then marks it discarded. */
  abstract discard(
    id: string,
    beforeUpdate: (row: DlqMessageRecord) => void,
  ): Promise<DlqTransitionResult>;
}
