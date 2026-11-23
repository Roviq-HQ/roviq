import type { AdminAttendanceSummaryRow } from './types';

export abstract class AdminAttendanceRepository {
  /** One row per institute that recorded attendance on `date`, ordered by English name. */
  abstract summaryForDate(date: string): Promise<AdminAttendanceSummaryRow[]>;
}
