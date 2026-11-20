import {
  COMPLIANCE_REPORT_TYPE_VALUES,
  type ComplianceReportType,
} from '../enums/compliance-export';

/** What decides which compliance exports an institute qualifies for. */
export interface ExportEligibilityInput {
  /** Boards of the institute's affiliations that are not REVOKED. */
  boards: readonly string[];
  /** State from the institute's address, if any. */
  state: string | null | undefined;
  /** Types of the institute's identifiers (e.g. `SHALA_DARPAN_ID`). */
  identifierTypes: readonly string[];
}

const EVERY_INSTITUTE: readonly ComplianceReportType[] = [
  'UDISE_DCF',
  'RTE_REPORT',
  'TC_REGISTER',
  'AWR',
];

/**
 * Report types an institute qualifies for, in enum order: the national ones always, a board's
 * exports only with a live affiliation to that board, Shala Darpan only for Rajasthan. The
 * one rule for both the screen and the API.
 */
export function eligibleComplianceReportTypes(
  input: ExportEligibilityInput,
): ComplianceReportType[] {
  const boards = new Set(input.boards.map((board) => board.trim().toUpperCase()));
  const inRajasthan =
    boards.has('RBSE') ||
    input.state?.trim().toLowerCase() === 'rajasthan' ||
    input.identifierTypes.includes('SHALA_DARPAN_ID');

  const offered = new Set<ComplianceReportType>(EVERY_INSTITUTE);
  if (boards.has('CBSE')) {
    offered.add('CBSE_REGISTRATION');
    offered.add('CBSE_LOC');
  }
  if (boards.has('BSEH')) offered.add('BSEH_STAFF_STATEMENT');
  if (inRajasthan) offered.add('SHALA_DARPAN');
  return COMPLIANCE_REPORT_TYPE_VALUES.filter((type) => offered.has(type));
}
