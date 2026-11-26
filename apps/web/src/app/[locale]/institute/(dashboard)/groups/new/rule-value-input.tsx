'use client';

import {
  ACADEMIC_STATUS_VALUES,
  ADMISSION_TYPE_VALUES,
  GENDER_VALUES,
  SOCIAL_CATEGORY_VALUES,
  STUDENT_STREAM_VALUES,
} from '@roviq/common-types';
import { useI18nField } from '@roviq/i18n';
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { StandardSectionSelect } from '@web/components/pickers/standard-section-select';
import { useTranslations } from 'next-intl';
import { useStandards } from '../../academics/use-academics';

const { instituteGroups } = testIds;

const YES_NO_DIMENSIONS = new Set(['is_minority', 'is_bpl', 'is_cwsn', 'is_rte_admitted']);

interface Choice {
  value: string;
  label: string;
}

/**
 * The value of one rule condition: the dimension's own values where it has a fixed set, the
 * institute's classes or sections for their ids, and free text otherwise (names, dates, and the
 * house and route ids, which have no picker yet).
 */
export function RuleValueInput({
  dimension,
  value,
  onChange,
}: {
  dimension: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('groups');
  const choices = useChoices(dimension);

  if (dimension === 'standard_id') return <StandardValueSelect value={value} onChange={onChange} />;
  if (dimension === 'section_id') {
    return (
      <StandardSectionSelect
        sectionId={value || null}
        onSectionChange={(sectionId) => onChange(sectionId ?? '')}
        standardTestId={instituteGroups.newRuleValueSectionStandard}
        sectionTestId={instituteGroups.newRuleValue}
      />
    );
  }
  if (choices) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="h-8 w-[200px]"
          aria-label={t('new.rule.value')}
          data-testid={instituteGroups.newRuleValue}
        >
          <SelectValue placeholder={t('new.rule.chooseValue')} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('new.rule.valuePlaceholder')}
      className="h-8 w-[200px]"
      aria-label={t('new.rule.value')}
      data-testid={instituteGroups.newRuleValue}
    />
  );
}

function StandardValueSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('groups');
  const resolveI18n = useI18nField();
  const { standards } = useStandards();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="h-8 w-[200px]"
        aria-label={t('new.rule.value')}
        data-testid={instituteGroups.newRuleValue}
      >
        <SelectValue placeholder={t('new.rule.chooseValue')} />
      </SelectTrigger>
      <SelectContent>
        {standards.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {resolveI18n(s.name)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function useChoices(dimension: string): Choice[] | null {
  const t = useTranslations('groups');
  const tStudents = useTranslations('students');
  const of = (values: readonly string[], label: (v: string) => string) =>
    values.map((v) => ({ value: v, label: label(v) }));

  if (YES_NO_DIMENSIONS.has(dimension)) {
    return of(['true', 'false'], (v) => t(`ruleValues.boolean.${v}`));
  }
  switch (dimension) {
    case 'gender':
      return of(GENDER_VALUES, (v) => tStudents(`genders.${v}`));
    case 'social_category':
      return of(SOCIAL_CATEGORY_VALUES, (v) => tStudents(`socialCategories.${v}`));
    case 'academic_status':
      return of(ACADEMIC_STATUS_VALUES, (v) => tStudents(`academicStatuses.${v}`));
    case 'admission_type':
      return of(ADMISSION_TYPE_VALUES, (v) => tStudents(`new.admissionTypes.${v}`));
    case 'stream':
      return of(STUDENT_STREAM_VALUES, (v) => t(`ruleValues.stream.${v}`));
    default:
      return null;
  }
}
