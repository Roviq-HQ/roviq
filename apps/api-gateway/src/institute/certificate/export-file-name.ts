import type { ComplianceReportType } from '@roviq/common-types';

/** Anything but letters, digits, dot, dash and underscore becomes a dash. */
function safe(part: string): string {
  return part
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/** `<institute code>-<report type>-<academic year label>.xlsx`, e.g. `RVQ-001-UDISE_DCF-2025-26.xlsx`. */
export function complianceExportFileName(params: {
  instituteCode: string;
  reportType: ComplianceReportType;
  academicYearLabel: string;
}): string {
  const parts = [params.instituteCode, params.reportType, params.academicYearLabel]
    .map(safe)
    .filter((part) => part.length > 0);
  return `${parts.join('-')}.xlsx`;
}
