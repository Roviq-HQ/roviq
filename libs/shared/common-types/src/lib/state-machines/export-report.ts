import type { ExportReportStatus } from '../enums/compliance-export';
import { defineStateMachine } from '../state-machine';

export const EXPORT_REPORT_STATE_MACHINE = defineStateMachine<ExportReportStatus>('ExportReport', {
  // FAILED straight from PENDING: the workflow could not be started.
  PENDING: ['RUNNING', 'FAILED'],
  RUNNING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
});
