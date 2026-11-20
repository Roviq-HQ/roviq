import type { FileSweeper, SweepSummary } from '../file-sweeper';

export function createFileSweeperActivities(sweeper: FileSweeper) {
  return {
    sweepFiles(): Promise<SweepSummary> {
      return sweeper.sweep(new Date());
    },
  };
}

export type FileSweeperActivities = ReturnType<typeof createFileSweeperActivities>;
