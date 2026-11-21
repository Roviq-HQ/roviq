import type {
  EmploymentType,
  Gender,
  MinorityType,
  SocialCategory,
  UserIdentifierType,
} from '@roviq/common-types';

/** Resolve an i18nText jsonb value to a single display string (en → first → ''). */
export function resolveI18n(value: Record<string, string> | null | undefined): string {
  if (!value) return '';
  return value.en ?? Object.values(value)[0] ?? '';
}

export function fullName(profile: {
  firstName: Record<string, string> | null;
  lastName: Record<string, string> | null;
}): string {
  return `${resolveI18n(profile.firstName)} ${resolveI18n(profile.lastName)}`.trim();
}

/** YYYY-MM-DD → DD/MM/YYYY, the format state portals expect. */
export function formatDateDmy(value: string | null | undefined): string {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

const GENDER_LABEL: { readonly [G in Gender]: string } = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
};

export function genderLabel(gender: Gender | null | undefined): string {
  return gender ? GENDER_LABEL[gender] : '';
}

const EMPLOYMENT_TYPE_LABEL: { readonly [E in EmploymentType]: string } = {
  REGULAR: 'Regular',
  CONTRACTUAL: 'Contractual',
  PART_TIME: 'Part-time',
  GUEST: 'Guest',
  VOLUNTEER: 'Volunteer',
};

export function employmentTypeLabel(type: EmploymentType | null | undefined): string {
  return type ? EMPLOYMENT_TYPE_LABEL[type] : '';
}

/** The recorded nature of appointment; staff forms only set the employment type, so that stands in. */
export function natureOfAppointment(staff: {
  natureOfAppointment: string | null;
  employmentType: EmploymentType | null;
}): string {
  return staff.natureOfAppointment || employmentTypeLabel(staff.employmentType);
}

const SOCIAL_CATEGORY_LABEL: { readonly [C in SocialCategory]: string } = {
  GENERAL: 'General',
  SC: 'SC',
  ST: 'ST',
  OBC: 'OBC',
  EWS: 'EWS',
};

export function socialCategoryLabel(category: SocialCategory | null | undefined): string {
  return category ? SOCIAL_CATEGORY_LABEL[category] : '';
}

const MINORITY_LABEL: { readonly [M in MinorityType]: string } = {
  MUSLIM: 'Muslim',
  CHRISTIAN: 'Christian',
  SIKH: 'Sikh',
  BUDDHIST: 'Buddhist',
  PARSI: 'Parsi',
  JAIN: 'Jain',
  OTHER: 'Other',
};

/** UDISE+ DCF 4.1.14 lists "Not Applicable" for a student of no minority group. */
export function minorityLabel(minority: MinorityType | null | undefined): string {
  return minority ? MINORITY_LABEL[minority] : 'Not Applicable';
}

/** `YYYY-MM-DD…` or a Date → DD/MM/YYYY; dates are calendar days, so no time zone shift. */
export function formatDateDmyOf(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    // IST calendar day of a timestamp.
    const ist = new Date(value.getTime() + 330 * 60 * 1000).toISOString();
    return formatDateDmy(ist);
  }
  return formatDateDmy(value);
}

export function yesNo(value: boolean): 'Yes' | 'No' {
  return value ? 'Yes' : 'No';
}

/** Identifier types whose full value never leaves the database (DPDP). */
const MASKED_ONLY: ReadonlySet<UserIdentifierType> = new Set(['AADHAAR', 'PAN']);

/** userId → identifier value for one identifier type; Aadhaar and PAN only ever masked. */
export function identifierMap(
  rows: ReadonlyArray<{
    userId: string;
    type: UserIdentifierType;
    valuePlain: string | null;
    valueMasked: string | null;
  }>,
  type: UserIdentifierType,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.type !== type) continue;
    const value = MASKED_ONLY.has(type) ? row.valueMasked : (row.valuePlain ?? row.valueMasked);
    if (value) map.set(row.userId, value);
  }
  return map;
}

/** Group rows by a key, keeping their order. */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}
