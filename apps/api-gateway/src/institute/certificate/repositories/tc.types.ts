import type { AcademicStatus, CbseTcData, TcStatus } from '@roviq/common-types';
import type { I18nContent, InstituteAddress, TcClearances } from '@roviq/database';

/** A `tc_register` row as read from `tc_register_live`. */
export interface TcRow {
  id: string;
  studentProfileId: string;
  academicYearId: string;
  tcSerialNumber: string;
  status: TcStatus;
  isDuplicate: boolean;
  originalTcId: string | null;
  tcData: CbseTcData;
  pdfFileId: string | null;
}

/** A TC with the student's name and the standard of the TC's year, for list and detail. */
export interface TcDetailsRow {
  id: string;
  studentProfileId: string;
  tcSerialNumber: string;
  academicYearId: string;
  status: TcStatus;
  reason: string;
  tcData: CbseTcData;
  clearances: TcClearances | null;
  pdfFileId: string | null;
  /** Opaque token of the public verification page; null until issued. */
  verificationToken: string | null;
  issuedAt: Date | null;
  admissionNumber: string;
  isDuplicate: boolean;
  originalTcId: string | null;
  isCounterSigned: boolean | null;
  createdAt: Date;
  studentFirstName: I18nContent;
  studentLastName: I18nContent | null;
  standardName: I18nContent | null;
}

export interface TcListFilter {
  status?: TcStatus;
  studentProfileId?: string;
  originalTcId?: string;
}

export interface CreateTcRequestData {
  studentProfileId: string;
  academicYearId: string;
  reason: string;
  /** Placeholder until issuance allocates the real serial. */
  tempSerial: string;
  actorId: string;
}

export interface CreateDuplicateTcData {
  original: TcRow;
  reason: string;
  duplicateFee: bigint | null;
  tempSerial: string;
  actorId: string;
}

export interface IssueTcData {
  tc: TcRow;
  /** YYYY-MM-DD, written as the issue and leaving date. */
  today: string;
  /** Opaque, unguessable; printed in the QR code. */
  verificationToken: string;
  actorId: string;
}

/** An original TC issue: its serial, and the student's status before TRANSFERRED_OUT. */
export interface IssuedOriginalTc {
  serial: string;
  fromStatus: AcademicStatus;
}

export interface StudentStatusRow {
  academicStatus: AcademicStatus;
}

/** What a certificate prints at its top. */
export interface InstituteLetterheadRow {
  name: I18nContent;
  address: InstituteAddress | null;
  board: string | null;
  affiliationNumber: string | null;
  logoFileId: string | null;
}
