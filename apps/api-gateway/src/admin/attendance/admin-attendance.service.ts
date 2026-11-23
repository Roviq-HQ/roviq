/**
 * Cross-tenant attendance roll-up for the platform admin portal: one row per
 * institute for the given date. Institutes with zero sessions are omitted.
 */
import { Injectable } from '@nestjs/common';
import { AdminAttendanceRepository } from './repositories/admin-attendance.repository';
import type { AdminAttendanceSummaryRow } from './repositories/types';

export type { AdminAttendanceSummaryRow } from './repositories/types';

@Injectable()
export class AdminAttendanceService {
  constructor(private readonly repo: AdminAttendanceRepository) {}

  /** Ordered by institute name so the UI has a stable page order without a client-side sort. */
  summaryForDate(date: string): Promise<AdminAttendanceSummaryRow[]> {
    return this.repo.summaryForDate(date);
  }
}
