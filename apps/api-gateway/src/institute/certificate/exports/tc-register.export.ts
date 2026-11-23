/**
 * TC Register Export (ROV-171, ROV-296).
 *
 * Every transfer certificate ISSUED in the chosen academic year, by TC serial number. No
 * official layout was found: the student is shown by name and admission number, dates as
 * DD/MM/YYYY (India time).
 */
import { TcStatus } from '@roviq/common-types';
import {
  type DrizzleDB,
  mkInstituteCtx,
  studentProfilesLive,
  tcRegisterLive,
  tenantUserProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, asc, eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { formatDateDmyOf, fullName, yesNo } from './export-helpers';
import type { ComplianceExportOutput } from './types';

export const TC_REGISTER_HEADERS = [
  'TC Serial Number',
  'Student Name',
  'Status',
  'Reason',
  'Requested At',
  'Issued At',
  'Is Duplicate',
  'Admission Number',
];

const ORIGIN = 'workflow:compliance-export-tc-register';

function issuedTcs(tx: DrizzleDB, academicYearId: string) {
  return tx
    .select({
      tcSerialNumber: tcRegisterLive.tcSerialNumber,
      status: tcRegisterLive.status,
      reason: tcRegisterLive.reason,
      requestedAt: tcRegisterLive.requestedAt,
      issuedAt: tcRegisterLive.issuedAt,
      isDuplicate: tcRegisterLive.isDuplicate,
      admissionNumber: studentProfilesLive.admissionNumber,
      firstName: tenantUserProfilesLive.firstName,
      lastName: tenantUserProfilesLive.lastName,
    })
    .from(tcRegisterLive)
    .leftJoin(studentProfilesLive, eq(studentProfilesLive.id, tcRegisterLive.studentProfileId))
    .leftJoin(
      tenantUserProfilesLive,
      and(
        eq(tenantUserProfilesLive.userId, studentProfilesLive.userId),
        eq(tenantUserProfilesLive.tenantId, studentProfilesLive.tenantId),
      ),
    )
    .where(
      and(
        eq(tcRegisterLive.academicYearId, academicYearId),
        eq(tcRegisterLive.status, TcStatus.ISSUED),
      ),
    )
    .orderBy(asc(tcRegisterLive.tcSerialNumber));
}

export type TcRegisterRow = Awaited<ReturnType<typeof issuedTcs>>[number];

export async function generateTcRegisterExport(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<ComplianceExportOutput> {
  const tcs = await withTenant(db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
    issuedTcs(tx, academicYearId),
  );
  return buildTcRegister(tcs);
}

export function buildTcRegister(tcs: readonly TcRegisterRow[]): ComplianceExportOutput {
  const rows = tcs.map((tc) => ({
    'TC Serial Number': tc.tcSerialNumber,
    'Student Name': fullName(tc),
    Status: tc.status,
    Reason: tc.reason,
    'Requested At': formatDateDmyOf(tc.requestedAt),
    'Issued At': formatDateDmyOf(tc.issuedAt),
    'Is Duplicate': yesNo(tc.isDuplicate),
    'Admission Number': tc.admissionNumber ?? '',
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rows, { header: TC_REGISTER_HEADERS }),
    'TC Register',
  );
  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount: rows.length,
  };
}
