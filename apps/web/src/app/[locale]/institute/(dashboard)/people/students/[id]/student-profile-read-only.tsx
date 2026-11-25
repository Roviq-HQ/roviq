'use client';

import { useFormatDate, useI18nField } from '@roviq/i18n';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet, useAbility } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import type { StudentDetailNode } from '../use-students';

const { instituteStudents } = testIds;

interface ProfileRow {
  /** The GraphQL field name, which is also the CASL field name. */
  field: keyof StudentDetailNode;
  label: string;
  value: string | null;
}

interface ProfileSection {
  key: string;
  legend: string;
  rows: ProfileRow[];
}

/**
 * The profile for a role that can read the student but not edit it. A field the role may not
 * read is left out: the server sends it as null, and an empty row would read as "not recorded".
 */
export function StudentProfileReadOnly({ student }: { student: StudentDetailNode }) {
  const t = useTranslations('students');
  const resolveI18n = useI18nField();
  const { format } = useFormatDate();
  const ability = useAbility();
  const yesNo = (value: boolean | null | undefined) =>
    value == null ? null : t(value ? 'detail.profile.yes' : 'detail.profile.no');

  const sections: ProfileSection[] = [
    {
      key: 'personal',
      legend: t('detail.profile.sections.personal'),
      rows: [
        {
          field: 'firstName',
          label: t('detail.profile.firstName'),
          value: resolveI18n(student.firstName) || null,
        },
        {
          field: 'lastName',
          label: t('detail.profile.lastName'),
          value: resolveI18n(student.lastName) || null,
        },
        {
          field: 'gender',
          label: t('detail.profile.gender'),
          value: student.gender ? t(`genders.${student.gender}`) : null,
        },
        {
          field: 'dateOfBirth',
          label: t('detail.profile.dateOfBirth'),
          value: student.dateOfBirth ? format(parseISO(student.dateOfBirth), 'dd/MM/yyyy') : null,
        },
        {
          field: 'bloodGroup',
          label: t('detail.profile.bloodGroup'),
          value: student.bloodGroup ?? null,
        },
      ],
    },
    {
      key: 'identity',
      legend: t('detail.profile.sections.identity'),
      rows: [
        { field: 'religion', label: t('detail.profile.religion'), value: student.religion ?? null },
        { field: 'caste', label: t('detail.profile.caste'), value: student.caste ?? null },
        {
          field: 'motherTongue',
          label: t('detail.profile.motherTongue'),
          value: student.motherTongue ?? null,
        },
      ],
    },
    {
      key: 'regulatory',
      legend: t('detail.profile.sections.regulatory'),
      rows: [
        {
          field: 'socialCategory',
          label: t('detail.profile.category'),
          value: student.socialCategory ? t(`socialCategories.${student.socialCategory}`) : null,
        },
        {
          field: 'isRteAdmitted',
          label: t('detail.profile.rteAdmitted'),
          value: yesNo(student.isRteAdmitted),
        },
        { field: 'isCwsn', label: t('detail.profile.cwsn'), value: yesNo(student.isCwsn) },
        ...(student.isCwsn
          ? [
              {
                field: 'cwsnType' as const,
                label: t('detail.profile.cwsnTypeLabel'),
                value: student.cwsnType ?? null,
              },
            ]
          : []),
        {
          field: 'isMinority',
          label: t('detail.profile.minority'),
          value: yesNo(student.isMinority),
        },
        ...(student.isMinority
          ? [
              {
                field: 'minorityType' as const,
                label: t('detail.profile.minorityTypeLabel'),
                value: student.minorityType ?? null,
              },
            ]
          : []),
        { field: 'isBpl', label: t('detail.profile.bpl'), value: yesNo(student.isBpl) },
      ],
    },
  ];

  return (
    <div className="space-y-6" data-testid={instituteStudents.detailProfileReadOnly}>
      {sections.map((section) => {
        const rows = section.rows.filter((row) => ability.can('read', 'Student', row.field));
        if (rows.length === 0) return null;
        return (
          <FieldSet key={section.key} className="print:break-inside-avoid">
            <FieldLegend>{section.legend}</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              {rows.map((row) => (
                <Field key={row.field} data-testid={instituteStudents.detailProfileRow(row.field)}>
                  <FieldLabel>{row.label}</FieldLabel>
                  <p className="text-sm">{row.value ?? t('detail.profile.notSet')}</p>
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
        );
      })}
      <AdmissionInfoSection student={student} />
      <MedicalInfoSection student={student} />
    </div>
  );
}

/** Admission details are never edited on this tab, so both views show them as text. */
export function AdmissionInfoSection({ student }: { student: StudentDetailNode }) {
  const t = useTranslations('students');
  const { format } = useFormatDate();
  const ability = useAbility();
  const canRead = (field: keyof StudentDetailNode) => ability.can('read', 'Student', field);

  return (
    <FieldSet className="print:break-inside-avoid">
      <FieldLegend>{t('detail.profile.admissionInfo')}</FieldLegend>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {canRead('admissionNumber') && (
          <Field>
            <FieldLabel>{t('detail.profile.admissionNumber')}</FieldLabel>
            <p className="text-sm font-mono">{student.admissionNumber}</p>
          </Field>
        )}
        {canRead('admissionDate') && student.admissionDate && (
          <Field>
            <FieldLabel>{t('detail.profile.admittedOn')}</FieldLabel>
            <p className="text-sm">{format(parseISO(student.admissionDate), 'dd/MM/yyyy')}</p>
          </Field>
        )}
        {canRead('admissionClass') && student.admissionClass && (
          <Field>
            <FieldLabel>{t('detail.profile.admissionClass')}</FieldLabel>
            <p className="text-sm">{student.admissionClass}</p>
          </Field>
        )}
        {canRead('admissionType') && (
          <Field>
            <FieldLabel>{t('detail.profile.admissionType')}</FieldLabel>
            <p className="text-sm">{student.admissionType}</p>
          </Field>
        )}
      </FieldGroup>
    </FieldSet>
  );
}

/** Hidden from roles that may not read medical details, rather than shown as "none recorded". */
export function MedicalInfoSection({ student }: { student: StudentDetailNode }) {
  const t = useTranslations('students');
  const ability = useAbility();
  if (!ability.can('read', 'Student', 'medicalInfo')) return null;

  return (
    <FieldSet
      className="print:break-inside-avoid"
      data-testid={instituteStudents.detailMedicalInfo}
    >
      <FieldLegend>{t('detail.profile.medicalInfo')}</FieldLegend>
      {student.medicalInfo && Object.keys(student.medicalInfo).length > 0 ? (
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {Object.entries(student.medicalInfo).map(([key, value]) => (
            <Field key={key}>
              <FieldLabel className="capitalize">{key.replace(/_/g, ' ')}</FieldLabel>
              <p className="text-sm">{String(value ?? '—')}</p>
            </Field>
          ))}
        </FieldGroup>
      ) : (
        <p className="text-sm text-muted-foreground">{t('detail.profile.medicalEmpty')}</p>
      )}
    </FieldSet>
  );
}
