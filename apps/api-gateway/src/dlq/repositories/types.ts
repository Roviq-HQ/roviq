import type { dlqMessages } from '@roviq/database';

export type DlqMessageRecord = typeof dlqMessages.$inferSelect;

export interface DlqListQuery {
  originStream?: string;
  status?: DlqMessageRecord['status'];
  tenantId?: string;
  /** Keyset cursor: only rows with an id below this one. */
  beforeId?: string;
  /** Rows to fetch (page size + 1 to detect a next page). */
  limit: number;
}

export type DlqTransitionResult =
  | { kind: 'not_found' }
  | { kind: 'ok'; row: DlqMessageRecord | undefined };
