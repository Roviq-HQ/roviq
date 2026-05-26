'use client';

import { useI18nField } from '@roviq/i18n';
import { Checkbox, FieldLabel } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { type Standard, useSections } from '../academics/use-academics';

const { instituteTimetable } = testIds;

/**
 * Hierarchical section selector for the create wizard. Renders each standard
 * with its sections (loaded lazily per standard via the existing
 * `useSections` query). Selection is a flat list of section IDs the parent
 * form owns; this component is purely presentational + toggles.
 */
export function SectionPicker({
  standards,
  selected,
  onToggle,
}: {
  standards: Standard[];
  selected: string[];
  onToggle: (sectionId: string) => void;
}) {
  const t = useTranslations('timetable');

  if (standards.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('wizard.noSections')}</p>;
  }

  return (
    <div className="space-y-3 rounded-lg border p-3 max-h-64 overflow-y-auto">
      {standards.map((standard) => (
        <StandardSections
          key={standard.id}
          standard={standard}
          selected={selected}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function StandardSections({
  standard,
  selected,
  onToggle,
}: {
  standard: Standard;
  selected: string[];
  onToggle: (sectionId: string) => void;
}) {
  const resolveI18n = useI18nField();
  const { sections } = useSections(standard.id);

  if (sections.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-1.5">
        {resolveI18n(standard.name)}
      </p>
      <div className="flex flex-wrap gap-3">
        {sections.map((section) => {
          const id = `tt-wizard-section-${section.id}`;
          return (
            <div key={section.id} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                id={id}
                checked={selected.includes(section.id)}
                onCheckedChange={() => onToggle(section.id)}
                data-testid={instituteTimetable.wizardSection(section.id)}
              />
              <FieldLabel htmlFor={id} className="cursor-pointer">
                {section.displayLabel ?? resolveI18n(section.name)}
              </FieldLabel>
            </div>
          );
        })}
      </div>
    </div>
  );
}
