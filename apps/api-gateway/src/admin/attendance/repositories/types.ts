export interface AdminAttendanceSummaryRow {
  instituteId: string;
  instituteName: Record<string, string>;
  presentCount: number;
  absentCount: number;
  leaveCount: number;
  lateCount: number;
  sessionCount: number;
}
