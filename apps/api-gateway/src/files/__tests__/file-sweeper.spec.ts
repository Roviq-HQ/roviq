import { metrics } from '@opentelemetry/api';
import { FILE_PURPOSE_VALUES, type FileStatus, type FileVisibility } from '@roviq/common-types';
import type { StorageBucket } from '@roviq/storage';
import { FakeStorageClient } from '@roviq/storage';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_RETIREMENT,
  type FilePurgeRepository,
  type PurgeCandidate,
  type SweepSelection,
} from '../file-purge.repository';
import { FileSweeper, SWEEP_BATCH_SIZE, SWEEP_MAX_BATCHES } from '../file-sweeper';

const NOW = new Date('2026-11-20T10:00:00Z');
const FILE_A = '00000000-0000-7000-a000-00000000000a';
const FILE_B = '00000000-0000-7000-a000-00000000000b';
const FILE_C = '00000000-0000-7000-a000-00000000000c';

function candidate(
  id: string,
  status: FileStatus,
  visibility: FileVisibility = 'PRIVATE',
): PurgeCandidate {
  return { id, status, visibility, objectKey: `institutes/t/leave-attachment/${id}.pdf` };
}

function storedKeys(id: string): string[] {
  const base = `institutes/t/leave-attachment/${id}`;
  return [`${base}.pdf`, `${base}/sm.webp`, `${base}/md.webp`, `${base}/full.webp`];
}

/** Records storage deletes and repository writes in the order they happen. */
class RecordingStorage extends FakeStorageClient {
  readonly failFor = new Set<string>();
  constructor(private readonly calls: string[]) {
    super();
  }
  override async delete(bucket: StorageBucket, keys: string[]): Promise<void> {
    this.calls.push(`delete ${bucket} ${keys.join(',')}`);
    if (keys.some((key) => this.failFor.has(key))) throw new Error('storage unavailable');
    await super.delete(bucket, keys);
  }
}

describe('FileSweeper', () => {
  let calls: string[];
  let storage: RecordingStorage;
  let stale: Record<SweepSelection, PurgeCandidate[][]>;
  let findStale: ReturnType<typeof vi.fn<FilePurgeRepository['findStale']>>;
  let retireUnneeded: ReturnType<typeof vi.fn<FilePurgeRepository['retireUnneeded']>>;
  let findByIds: ReturnType<typeof vi.fn<FilePurgeRepository['findByIds']>>;
  let isInUse: ReturnType<typeof vi.fn<FilePurgeRepository['isInUse']>>;
  let rejectPending: ReturnType<typeof vi.fn<FilePurgeRepository['rejectPending']>>;
  let removeRow: ReturnType<typeof vi.fn<FilePurgeRepository['removeRow']>>;
  let add: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.fn<(message: string) => void>>;
  let sweeper: FileSweeper;

  beforeEach(() => {
    calls = [];
    storage = new RecordingStorage(calls);
    stale = { pending: [], rejected: [], deleted: [] };
    retireUnneeded = vi
      .fn<FilePurgeRepository['retireUnneeded']>()
      .mockResolvedValue({ timed: [], unused: [] });
    findStale = vi.fn<FilePurgeRepository['findStale']>(
      async (selection) => stale[selection].shift() ?? [],
    );
    findByIds = vi.fn<FilePurgeRepository['findByIds']>().mockResolvedValue([]);
    isInUse = vi.fn<FilePurgeRepository['isInUse']>().mockResolvedValue(false);
    rejectPending = vi.fn<FilePurgeRepository['rejectPending']>(async (id) => {
      calls.push(`rejectPending ${id}`);
      return true;
    });
    removeRow = vi.fn<FilePurgeRepository['removeRow']>(async (id, status) => {
      calls.push(`removeRow ${id} ${status}`);
      return true;
    });
    add = vi.fn();
    vi.spyOn(metrics, 'getMeter').mockReturnValue(
      createMock<ReturnType<typeof metrics.getMeter>>({
        createCounter: vi.fn().mockReturnValue({ add }),
      }),
    );
    log = vi.fn<(message: string) => void>();
    sweeper = new FileSweeper(
      createMock<FilePurgeRepository>({
        retireUnneeded,
        findStale,
        findByIds,
        isInUse,
        rejectPending,
        removeRow,
      }),
      storage,
      { log, warn: vi.fn<(message: string) => void>() },
    );
  });

  describe('sweep', () => {
    it('should reject a stale upload, delete its objects and only then remove its row', async () => {
      stale.pending = [[candidate(FILE_A, 'PENDING')]];

      const summary = await sweeper.sweep(NOW);

      expect(calls).toEqual([
        `rejectPending ${FILE_A}`,
        `delete private pending/${storedKeys(FILE_A)[0]}`,
        `delete private ${storedKeys(FILE_A).join(',')}`,
        `removeRow ${FILE_A} REJECTED`,
      ]);
      expect(summary.pending).toEqual({ removed: 1, failed: 0, skipped: 0 });
    });

    it('should delete a rejected upload from both its pending key and its own bucket', async () => {
      stale.rejected = [[candidate(FILE_A, 'REJECTED', 'PUBLIC')]];

      await sweeper.sweep(NOW);

      expect(calls).toEqual([
        `delete private pending/${storedKeys(FILE_A)[0]}`,
        `delete public ${storedKeys(FILE_A).join(',')}`,
        `removeRow ${FILE_A} REJECTED`,
      ]);
    });

    it('should delete a deleted file from its own bucket only', async () => {
      stale.deleted = [[candidate(FILE_A, 'DELETED', 'PUBLIC')]];

      const summary = await sweeper.sweep(NOW);

      expect(calls).toEqual([
        `delete public ${storedKeys(FILE_A).join(',')}`,
        `removeRow ${FILE_A} DELETED`,
      ]);
      expect(summary.deleted).toEqual({ removed: 1, failed: 0, skipped: 0 });
    });

    it('should keep the row when its objects could not be deleted, and go on with the next file', async () => {
      stale.deleted = [[candidate(FILE_A, 'DELETED'), candidate(FILE_B, 'DELETED')]];
      storage.failFor.add(storedKeys(FILE_A)[0] ?? '');

      const summary = await sweeper.sweep(NOW);

      expect(removeRow).not.toHaveBeenCalledWith(FILE_A, 'DELETED');
      expect(removeRow).toHaveBeenCalledWith(FILE_B, 'DELETED');
      expect(summary.deleted).toEqual({ removed: 1, failed: 1, skipped: 0 });
    });

    it('should not select a failed file again in the same run', async () => {
      stale.deleted = [[candidate(FILE_A, 'DELETED')], [candidate(FILE_B, 'DELETED')]];
      removeRow.mockImplementation(async (id) => id !== FILE_A);

      await sweeper.sweep(NOW);

      const deletedCalls = findStale.mock.calls.filter(([selection]) => selection === 'deleted');
      expect(deletedCalls).toEqual([
        ['deleted', NOW, SWEEP_BATCH_SIZE, []],
        ['deleted', NOW, SWEEP_BATCH_SIZE, [FILE_A]],
        ['deleted', NOW, SWEEP_BATCH_SIZE, [FILE_A]],
      ]);
    });

    it('should count a row that changed before it was removed as failed', async () => {
      stale.rejected = [[candidate(FILE_A, 'REJECTED')]];
      removeRow.mockResolvedValue(false);

      const summary = await sweeper.sweep(NOW);

      expect(summary.rejected).toEqual({ removed: 0, failed: 1, skipped: 0 });
    });

    it('should leave an upload alone when it was attached before it could be rejected', async () => {
      stale.pending = [[candidate(FILE_A, 'PENDING')]];
      rejectPending.mockResolvedValue(false);

      const summary = await sweeper.sweep(NOW);

      expect(calls).toEqual([]);
      expect(summary.pending).toEqual({ removed: 0, failed: 0, skipped: 1 });
    });

    it('should leave a file alone when a record points at it again', async () => {
      stale.deleted = [[candidate(FILE_A, 'DELETED')]];
      isInUse.mockResolvedValue(true);

      const summary = await sweeper.sweep(NOW);

      expect(calls).toEqual([]);
      expect(summary.deleted).toEqual({ removed: 0, failed: 0, skipped: 1 });
    });

    it('should stop after the batch cap even when more rows keep coming', async () => {
      let next = 0;
      findStale.mockImplementation(async (selection) =>
        selection === 'rejected' ? [candidate(`id-${next++}`, 'REJECTED')] : [],
      );

      const summary = await sweeper.sweep(NOW);

      const rejectedCalls = findStale.mock.calls.filter(([selection]) => selection === 'rejected');
      expect(rejectedCalls).toHaveLength(SWEEP_MAX_BATCHES);
      expect(summary.rejected.removed).toBe(SWEEP_MAX_BATCHES);
    });

    it('should retire unneeded files first and report them', async () => {
      retireUnneeded.mockResolvedValue({ timed: [FILE_A], unused: [FILE_B, FILE_C] });

      const summary = await sweeper.sweep(NOW);

      expect(retireUnneeded).toHaveBeenCalledWith(NOW, SWEEP_BATCH_SIZE);
      expect(summary).toEqual({
        retired: { timed: 1, unused: 2 },
        pending: { removed: 0, failed: 0, skipped: 0 },
        rejected: { removed: 0, failed: 0, skipped: 0 },
        deleted: { removed: 0, failed: 0, skipped: 0 },
      });
      expect(add).toHaveBeenCalledWith(1, { action: 'retired_timed', result: 'removed' });
      expect(add).toHaveBeenCalledWith(2, { action: 'retired_unused', result: 'removed' });
    });

    it('should count each file in the metric and log one summary line', async () => {
      stale.deleted = [[candidate(FILE_A, 'DELETED')]];

      await sweeper.sweep(NOW);

      expect(add).toHaveBeenCalledWith(1, { action: 'deleted', result: 'removed' });
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'File sweep: retired 0 timed and 0 unused; pending removed 0, failed 0, skipped 0; ' +
          'rejected removed 0, failed 0, skipped 0; deleted removed 1, failed 0, skipped 0',
      );
    });
  });

  describe('purge', () => {
    it('should remove files of any status, report used files and unknown ids', async () => {
      findByIds.mockResolvedValue([candidate(FILE_A, 'READY'), candidate(FILE_B, 'READY')]);
      isInUse.mockImplementation(async (id) => id === FILE_B);

      const result = await sweeper.purge([FILE_A, FILE_B, FILE_C]);

      expect(result).toEqual({ removed: [FILE_A], inUse: [FILE_B], missing: [FILE_C] });
      expect(calls).toEqual([
        `delete private pending/${storedKeys(FILE_A)[0]}`,
        `delete private ${storedKeys(FILE_A).join(',')}`,
        `removeRow ${FILE_A} READY`,
      ]);
    });

    it('should reject a pending upload before removing it', async () => {
      findByIds.mockResolvedValue([candidate(FILE_A, 'PENDING')]);

      await sweeper.purge([FILE_A]);

      expect(calls[0]).toBe(`rejectPending ${FILE_A}`);
      expect(calls.at(-1)).toBe(`removeRow ${FILE_A} REJECTED`);
    });

    it('should throw after trying every file when one could not be removed', async () => {
      findByIds.mockResolvedValue([candidate(FILE_A, 'DELETED'), candidate(FILE_B, 'DELETED')]);
      storage.failFor.add(storedKeys(FILE_A)[0] ?? '');

      await expect(sweeper.purge([FILE_A, FILE_B])).rejects.toThrow(
        `Could not purge files ${FILE_A}`,
      );
      expect(removeRow).toHaveBeenCalledWith(FILE_B, 'DELETED');
      expect(removeRow).not.toHaveBeenCalledWith(FILE_A, 'DELETED');
    });
  });

  describe('FILE_RETIREMENT', () => {
    it('should decide retirement for every file purpose', () => {
      expect(Object.keys(FILE_RETIREMENT).sort()).toEqual([...FILE_PURPOSE_VALUES].sort());
    });
  });
});
