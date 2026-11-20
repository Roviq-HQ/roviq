/**
 * RTE Enrollment Report Export (ROV-171, ROV-296).
 *
 * One row per class of the chosen academic year, in class order: RTE-admitted students
 * (Section 12(1)(c)) and all students enrolled. No official layout was found; the class is
 * shown by its name.
 */
import {
  type DrizzleDB,
  mkInstituteCtx,
  standardsLive,
  studentAcademicsLive,
  studentProfilesLive,
  withTenant,
} from '@roviq/database';
import { asc, eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { resolveI18n } from './export-helpers';
import type { ComplianceExportOutput } from './types';

export const RTE_HEADERS = ['Class', 'RTE Students Count', 'Total Students'];

const ORIGIN = 'workflow:compliance-export-rte-report';

export interface RteEnrolmentRow {
  standardId: string;
  standardName: Record<string, string>;
  isRteAdmitted: boolean;
}

export async function generateRteReport(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<ComplianceExportOutput> {
  const enrolments = await withTenant(db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
    tx
      .select({
        standardId: studentAcademicsLive.standardId,
        standardName: standardsLive.name,
        isRteAdmitted: studentProfilesLive.isRteAdmitted,
      })
      .from(studentAcademicsLive)
      .innerJoin(
        studentProfilesLive,
        eq(studentProfilesLive.id, studentAcademicsLive.studentProfileId),
      )
      .innerJoin(standardsLive, eq(standardsLive.id, studentAcademicsLive.standardId))
      .where(eq(studentAcademicsLive.academicYearId, academicYearId))
      .orderBy(asc(standardsLive.numericOrder)),
  );
  return buildRteReport(enrolments);
}

/** `enrolments` arrive in class order; the sheet keeps it. */
export function buildRteReport(enrolments: readonly RteEnrolmentRow[]): ComplianceExportOutput {
  const byClass = new Map<string, { name: string; total: number; rte: number }>();
  for (const row of enrolments) {
    const entry = byClass.get(row.standardId) ?? {
      name: resolveI18n(row.standardName),
      total: 0,
      rte: 0,
    };
    entry.total++;
    if (row.isRteAdmitted) entry.rte++;
    byClass.set(row.standardId, entry);
  }

  const rows = [...byClass.values()].map((entry) => ({
    Class: entry.name,
    'RTE Students Count': entry.rte,
    'Total Students': entry.total,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rows, { header: RTE_HEADERS }),
    'RTE Report',
  );
  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount: rows.length,
  };
}
