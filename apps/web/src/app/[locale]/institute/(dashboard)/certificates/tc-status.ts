import type { CbseTcData, TcStatus } from '@roviq/common-types';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Clock,
  Copy,
  Eraser,
  FileCheck,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import type * as React from 'react';

/** Badge colours per TC status; keyed by the backend enum so a new status fails to compile. */
export const TC_STATUS_CLASS: Record<TcStatus, string> = {
  REQUESTED: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  CLEARANCE_PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  CLEARANCE_COMPLETE: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  GENERATED: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  REVIEW_PENDING: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  APPROVED: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  ISSUED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  CANCELLED: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  DUPLICATE_REQUESTED: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  DUPLICATE_ISSUED: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
};

export const TC_STATUS_ICON: Record<TcStatus, React.ComponentType<{ className?: string }>> = {
  REQUESTED: Clock,
  CLEARANCE_PENDING: AlertCircle,
  CLEARANCE_COMPLETE: ShieldCheck,
  GENERATED: FileCheck,
  REVIEW_PENDING: UserCheck,
  APPROVED: Sparkles,
  ISSUED: CheckCircle2,
  CANCELLED: Eraser,
  DUPLICATE_REQUESTED: Copy,
  DUPLICATE_ISSUED: Award,
};

/** Departments the TC workflow clears; anything else is shown by its raw name. */
export const TC_CLEARANCE_DEPARTMENTS = ['accounts', 'library', 'lab', 'transport'] as const;
export type TcClearanceDepartment = (typeof TC_CLEARANCE_DEPARTMENTS)[number];

export function isKnownDepartment(value: string): value is TcClearanceDepartment {
  return (TC_CLEARANCE_DEPARTMENTS as readonly string[]).includes(value);
}

/** CBSE TC fields in the order they are printed on the certificate (see `CbseTcData`). */
export const TC_DATA_FIELDS = [
  'studentName',
  'motherName',
  'fatherOrGuardianName',
  'nationality',
  'socialCategory',
  'dateOfBirthFigures',
  'dateOfBirthWords',
  'whetherFailed',
  'subjectsStudied',
  'classLastStudied',
  'lastExamResult',
  'qualifiedForPromotion',
  'feesPaidUpTo',
  'feeConcession',
  'nccScoutGuide',
  'dateOfLeaving',
  'reasonForLeaving',
  'totalWorkingDays',
  'totalPresentDays',
  'generalConduct',
  'remarks',
  'dateOfIssue',
] as const satisfies ReadonlyArray<keyof CbseTcData>;

/** Snapshot fields holding a calendar date (`YYYY-MM-DD`), shown in the viewer's date format. */
export const TC_DATE_FIELDS: ReadonlySet<(typeof TC_DATA_FIELDS)[number]> = new Set([
  'dateOfBirthFigures',
  'dateOfLeaving',
  'dateOfIssue',
]);

export function isIsoCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
