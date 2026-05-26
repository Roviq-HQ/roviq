'use client';

import { useI18nField } from '@roviq/i18n';
import {
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import {
  useSections,
  useStandards,
} from '@web/app/[locale]/institute/(dashboard)/academics/use-academics';
import { useTranslations } from 'next-intl';
import * as React from 'react';

/**
 * Cascading Standard → Section selector reused by the section-timetable and
 * day-schedule pages. Built on the existing `standards` + `sections` queries.
 */
export function StandardSectionSelect({
  academicYearId,
  sectionId,
  onSectionChange,
  standardTestId,
  sectionTestId,
}: {
  academicYearId: string | null;
  sectionId: string | null;
  onSectionChange: (sectionId: string | null) => void;
  standardTestId?: string;
  sectionTestId?: string;
}) {
  const t = useTranslations('timetable');
  const resolveI18n = useI18nField();
  const { standards } = useStandards(academicYearId);
  const [standardId, setStandardId] = React.useState<string | null>(null);
  const { sections } = useSections(standardId);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field className="w-48">
        <FieldLabel>{t('view.selectStandard')}</FieldLabel>
        <Select
          value={standardId ?? undefined}
          onValueChange={(v) => {
            setStandardId(v);
            onSectionChange(null);
          }}
        >
          <SelectTrigger data-testid={standardTestId}>
            <SelectValue placeholder={t('view.selectStandard')} />
          </SelectTrigger>
          <SelectContent>
            {standards.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {resolveI18n(s.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field className="w-48">
        <FieldLabel>{t('view.selectSection')}</FieldLabel>
        <Select
          value={sectionId ?? undefined}
          onValueChange={(v) => onSectionChange(v)}
          disabled={!standardId}
        >
          <SelectTrigger data-testid={sectionTestId}>
            <SelectValue placeholder={t('view.selectSection')} />
          </SelectTrigger>
          <SelectContent>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.displayLabel ?? resolveI18n(section.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
