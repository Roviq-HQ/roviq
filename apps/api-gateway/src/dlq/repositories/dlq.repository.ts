import type { DlqListQuery, DlqMessageRecord, DlqTransitionResult } from './types';

export abstract class DlqRepository {
  /** Matching rows newest first, and the count of every row the filters match. */
  abstract list(query: DlqListQuery): Promise<{ records: DlqMessageRecord[]; totalCount: number }>;
  abstract countPending(): Promise<number>;
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
