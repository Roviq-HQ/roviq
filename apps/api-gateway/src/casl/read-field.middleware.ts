import { subject } from '@casl/ability';
import type { FieldMiddleware } from '@nestjs/graphql';
import type { AbilityRequestContext } from '@roviq/casl';
import type { AppAbility, AppSubject } from '@roviq/common-types';

const SUBJECTS: Readonly<Record<string, AppSubject>> = {
  StudentModel: 'Student',
  EnquiryModel: 'Enquiry',
  ApplicationModel: 'Application',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sensitiveField(key: string) {
  const normalized = key.replace(/[^a-z]/gi, '').toLowerCase();
  if (normalized.includes('aadhaar')) return 'aadhaar';
  if (['pan', 'pannumber', 'pancard'].includes(normalized)) return 'pan';
  if (normalized === 'annualincome') return 'annual_income';
  if (normalized === 'counselornotes' || normalized === 'counsellornotes') return 'counselorNotes';
  if (normalized === 'medicalinfo' || normalized === 'medicalinformation') return 'medicalInfo';
  return undefined;
}

function canReadSensitive(ability: AppAbility, field: string) {
  return field === 'counselorNotes'
    ? ability.can('read', 'CounselorNotes')
    : ability.can('read', 'Student', field);
}

export function redactSensitiveJson(value: unknown, ability: AppAbility): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry: unknown) => redactSensitiveJson(entry, ability))
      .filter((entry) => entry !== null);
  }
  if (!isRecord(value)) return value;
  const identityType = typeof value.type === 'string' ? sensitiveField(value.type) : undefined;
  if (identityType && !canReadSensitive(ability, identityType)) return null;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const field = sensitiveField(key);
      return field && !canReadSensitive(ability, field)
        ? []
        : [[key, redactSensitiveJson(entry, ability)]];
    }),
  );
}

export const readFieldMiddleware: FieldMiddleware<
  unknown,
  AbilityRequestContext,
  Record<string, unknown>,
  unknown
> = async ({ source, context, info }, next) => {
  const linkedStudent = info.parentType.name === 'GuardianLinkedStudentModel';
  const linkedFields: Readonly<Record<string, string>> = {
    studentProfileId: 'id',
    firstName: 'firstName',
    lastName: 'lastName',
    admissionNumber: 'admissionNumber',
    profileImage: 'profileImage',
    currentStandardName: 'currentStandardName',
    currentSectionName: 'currentSectionName',
  };
  const readField = linkedStudent ? linkedFields[info.fieldName] : info.fieldName;
  if (linkedStudent && !readField) return next();
  const name = linkedStudent ? 'Student' : SUBJECTS[info.parentType.name];
  if (!name) return next();
  const ability = context.req?.ability;
  if (!ability || !isRecord(source)) return null;
  const record = subject(name, {
    ...source,
    id: linkedStudent ? source.studentProfileId : source.id,
    sectionId: source.currentSectionId ?? source.sectionId,
    standardId: source.currentStandardId ?? source.standardId,
    academicYearId: source.currentAcademicYearId ?? source.academicYearId,
  });
  if (!ability.can('read', record, readField)) return null;
  const field = sensitiveField(info.fieldName);
  if (field && !canReadSensitive(ability, field)) return null;
  const value: unknown = await next();
  return info.fieldName === 'formData' ? redactSensitiveJson(value, ability) : value;
};
