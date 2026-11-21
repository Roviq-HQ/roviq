import type { LeaveRecord } from './use-leave';

/** "Asha Verma · S-2026/0001" for a student, the name alone for staff; null without a profile. */
export function leaveApplicantLabel(
  applicant: LeaveRecord['applicant'],
  resolveI18n: (value: Record<string, string> | null | undefined) => string | null | undefined,
): string | null {
  if (!applicant) return null;
  const name = [resolveI18n(applicant.firstName), resolveI18n(applicant.lastName)]
    .filter(Boolean)
    .join(' ');
  if (!name) return null;
  return applicant.admissionNumber ? `${name} · ${applicant.admissionNumber}` : name;
}
