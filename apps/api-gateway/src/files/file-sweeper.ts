import type { LoggerService } from '@nestjs/common';
import { type Counter, metrics } from '@opentelemetry/api';
import type { FileStatus } from '@roviq/common-types';
import type { StorageClient } from '@roviq/storage';
import type { FilePurgeRepository, PurgeCandidate, SweepSelection } from './file-purge.repository';
import { bucketOf, pendingKeyOf, storedKeysOf } from './storage-keys';

/** Rows fetched per query. */
export const SWEEP_BATCH_SIZE = 100;
/** Batches per selection per run; whatever is left waits for the next run. */
export const SWEEP_MAX_BATCHES = 20;

export type SweepAction = SweepSelection | 'retired_timed' | 'retired_unused' | 'purge';
export type SweepResult = 'removed' | 'failed' | 'skipped';

export interface SweepCounts {
  removed: number;
  failed: number;
  skipped: number;
}

export interface SweepSummary {
  /** READY files marked DELETED this run; their grace period starts now. */
  retired: { timed: number; unused: number };
  pending: SweepCounts;
  rejected: SweepCounts;
  deleted: SweepCounts;
}

export interface PurgeResult {
  removed: string[];
  /** A record still points at it; nothing was deleted. */
  inUse: string[];
  /** No such file. */
  missing: string[];
}

const SELECTIONS: readonly SweepSelection[] = ['pending', 'rejected', 'deleted'];

/** `in_use`: a record still points at the file. `attached`: a stale upload was attached meanwhile. */
type RemoveOutcome = 'removed' | 'failed' | 'in_use' | 'attached';

/**
 * Removes the objects and rows of files nobody needs any more: stale uploads, refused uploads,
 * and deleted files past their grace period. Runs across every institute (see
 * `FilePurgeRepository`). Objects go first, the row last, so a failure never leaves a row
 * pointing at nothing it could not retry.
 */
export class FileSweeper {
  private readonly counter: Counter;

  constructor(
    private readonly repo: FilePurgeRepository,
    private readonly storage: StorageClient,
    private readonly logger: Pick<LoggerService, 'log' | 'warn'>,
  ) {
    this.counter = metrics.getMeter('file-sweeper').createCounter('file_sweeper_files_total', {
      description: 'Files handled by the file sweeper, by action and result',
    });
  }

  async sweep(now: Date): Promise<SweepSummary> {
    const { timed, unused } = await this.repo.retireUnneeded(now, SWEEP_BATCH_SIZE);
    this.count('retired_timed', 'removed', timed.length);
    this.count('retired_unused', 'removed', unused.length);

    const summary: SweepSummary = {
      retired: { timed: timed.length, unused: unused.length },
      pending: emptyCounts(),
      rejected: emptyCounts(),
      deleted: emptyCounts(),
    };
    for (const selection of SELECTIONS) {
      summary[selection] = await this.sweepSelection(selection, now);
    }

    this.logger.log(
      `File sweep: retired ${timed.length} timed and ${unused.length} unused; ` +
        SELECTIONS.map((s) => `${s} ${formatCounts(summary[s])}`).join('; '),
    );
    return summary;
  }

  async purge(fileIds: string[]): Promise<PurgeResult> {
    const unique = [...new Set(fileIds)];
    const found = await this.repo.findByIds(unique);
    const foundIds = new Set(found.map((file) => file.id));
    const result: PurgeResult = {
      removed: [],
      inUse: [],
      missing: unique.filter((id) => !foundIds.has(id)),
    };
    const failed: string[] = [];

    for (const file of found) {
      const outcome = await this.removeFile('purge', file);
      if (outcome === 'removed') result.removed.push(file.id);
      else if (outcome === 'in_use') result.inUse.push(file.id);
      // An upload attached meanwhile is READY now; the retry purges it with that status.
      else failed.push(file.id);
      this.count(
        'purge',
        outcome === 'removed' ? 'removed' : outcome === 'in_use' ? 'skipped' : 'failed',
      );
    }
    if (failed.length > 0) {
      // The erasure workflow retries; files already removed then come back as missing.
      throw new Error(`Could not purge files ${failed.join(', ')}`);
    }
    return result;
  }

  private async sweepSelection(selection: SweepSelection, now: Date): Promise<SweepCounts> {
    const counts = emptyCounts();
    const skipIds: string[] = [];
    for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
      const candidates = await this.repo.findStale(selection, now, SWEEP_BATCH_SIZE, [...skipIds]);
      if (candidates.length === 0) break;
      for (const file of candidates) {
        const outcome = await this.removeFile(selection, file);
        const result: SweepResult =
          outcome === 'removed' || outcome === 'failed' ? outcome : 'skipped';
        counts[result]++;
        this.count(selection, result);
        if (result !== 'removed') skipIds.push(file.id);
      }
    }
    return counts;
  }

  private async removeFile(action: SweepAction, file: PurgeCandidate): Promise<RemoveOutcome> {
    try {
      if (await this.repo.isInUse(file.id)) return 'in_use';
      let status: FileStatus = file.status;
      if (status === 'PENDING') {
        // Out of reach of an attach before the objects go; false means it was attached first.
        if (!(await this.repo.rejectPending(file.id))) return 'attached';
        status = 'REJECTED';
      }
      // Only an upload that never got through verification can still have its pending object;
      // an erasure removes it whatever the status, in case a verification stopped half way.
      if (status === 'REJECTED' || action === 'purge') {
        await this.storage.delete('private', [pendingKeyOf(file)]);
      }
      await this.storage.delete(bucketOf(file), storedKeysOf(file));
      if (await this.repo.removeRow(file.id, status)) return 'removed';
      this.logger.warn(`File sweeper (${action}): row of file ${file.id} changed; kept it`);
      return 'failed';
    } catch (err) {
      this.logger.warn(
        `File sweeper (${action}): could not remove file ${file.id}: ${errorMessage(err)}`,
      );
      return 'failed';
    }
  }

  private count(action: SweepAction, result: SweepResult, by = 1): void {
    if (by > 0) this.counter.add(by, { action, result });
  }
}

function emptyCounts(): SweepCounts {
  return { removed: 0, failed: 0, skipped: 0 };
}

function formatCounts(counts: SweepCounts): string {
  return `removed ${counts.removed}, failed ${counts.failed}, skipped ${counts.skipped}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
