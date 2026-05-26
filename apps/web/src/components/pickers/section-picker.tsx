'use client';

import { useI18nField } from '@roviq/i18n';
import { Checkbox, FieldLabel } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  type Standard,
  useSections,
} from '@web/app/[locale]/institute/(dashboard)/academics/use-academics';
import { useTranslations } from 'next-intl';
import * as React from 'react';

const { instituteTimetable } = testIds;

/** Title-case an enum value like PRE_PRIMARY → "Pre Primary" for a fallback label. */
function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The school's "department" for a standard, per its chosen education policy:
 * the explicit `department` text if set, else the NEP stage, else the
 * education level. Standards with the same key group together.
 */
function departmentOf(s: Standard): { key: string; label: string } {
  if (s.department) return { key: `d:${s.department}`, label: s.department };
  if (s.nepStage) return { key: `n:${s.nepStage}`, label: formatEnum(s.nepStage) };
  if (s.level) return { key: `l:${s.level}`, label: formatEnum(s.level) };
  return { key: '__other__', label: '' };
}

const allIn = (ids: string[], selected: string[]) =>
  ids.length > 0 && ids.every((id) => selected.includes(id));

/**
 * Department → standard → section selector for the create wizard. Sections are
 * loaded lazily per standard, so each {@link StandardSections} reports its
 * section IDs up; that lets the department- and global-level "select all"
 * operate on the full set. Selection is a flat list of section IDs the parent
 * form owns; `onSetMany` applies a batch in one state update.
 */
export function SectionPicker({
  standards,
  selected,
  onToggle,
  onSetMany,
}: {
  standards: Standard[];
  selected: string[];
  onToggle: (sectionId: string) => void;
  onSetMany: (sectionIds: string[], select: boolean) => void;
}) {
  const t = useTranslations('timetable');
  const [idsByStandard, setIdsByStandard] = React.useState<Record<string, string[]>>({});

  const reportSections = React.useCallback((standardId: string, ids: string[]) => {
    setIdsByStandard((prev) => {
      const existing = prev[standardId];
      if (existing && existing.length === ids.length && existing.every((v, i) => v === ids[i])) {
        return prev;
      }
      return { ...prev, [standardId]: ids };
    });
  }, []);

  // Group standards by department, preserving standard order within each group.
  const groups = React.useMemo(() => {
    const map = new Map<string, { label: string; standards: Standard[] }>();
    for (const s of standards) {
      const { key, label } = departmentOf(s);
      const group = map.get(key) ?? { label: label || t('wizard.otherDepartment'), standards: [] };
      group.standards.push(s);
      map.set(key, group);
    }
    return [...map.entries()].map(([key, value]) => ({ key, ...value }));
  }, [standards, t]);

  const allIds = React.useMemo(() => Object.values(idsByStandard).flat(), [idsByStandard]);

  if (standards.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('wizard.noSections')}</p>;
  }

  return (
    <div
      className="overflow-hidden rounded-lg border"
      data-testid={instituteTimetable.sectionPicker}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {t('wizard.sectionsSelected', { count: selected.length })}
        </span>
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
          disabled={allIds.length === 0}
          onClick={() => onSetMany(allIds, !allIn(allIds, selected))}
          data-testid={instituteTimetable.sectionPickerSelectAll}
        >
          {allIn(allIds, selected) ? t('wizard.clearAll') : t('wizard.selectAll')}
        </button>
      </div>

      <div className="max-h-80 divide-y overflow-y-auto">
        {groups.map((group) => {
          const deptIds = group.standards.flatMap((s) => idsByStandard[s.id] ?? []);
          return (
            <div key={group.key} className="px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{group.label}</span>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  disabled={deptIds.length === 0}
                  onClick={() => onSetMany(deptIds, !allIn(deptIds, selected))}
                  data-testid={instituteTimetable.sectionPickerToggleDept(group.key)}
                >
                  {allIn(deptIds, selected) ? t('wizard.clearAll') : t('wizard.selectAll')}
                </button>
              </div>
              <div className="space-y-2 ps-2">
                {group.standards.map((standard) => (
                  <StandardSections
                    key={standard.id}
                    standard={standard}
                    selected={selected}
                    onToggle={onToggle}
                    onSetMany={onSetMany}
                    onLoaded={reportSections}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StandardSections({
  standard,
  selected,
  onToggle,
  onSetMany,
  onLoaded,
}: {
  standard: Standard;
  selected: string[];
  onToggle: (sectionId: string) => void;
  onSetMany: (sectionIds: string[], select: boolean) => void;
  onLoaded: (standardId: string, ids: string[]) => void;
}) {
  const resolveI18n = useI18nField();
  const t = useTranslations('timetable');
  const { sections } = useSections(standard.id);

  const sectionIds = React.useMemo(() => sections.map((s) => s.id), [sections]);

  React.useEffect(() => {
    if (sectionIds.length > 0) onLoaded(standard.id, sectionIds);
  }, [standard.id, sectionIds, onLoaded]);

  if (sections.length === 0) return null;

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {resolveI18n(standard.name)}
        </span>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => onSetMany(sectionIds, !allIn(sectionIds, selected))}
          data-testid={instituteTimetable.sectionPickerToggleAll(standard.id)}
        >
          {allIn(sectionIds, selected) ? t('wizard.clearAll') : t('wizard.selectAll')}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
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
              <FieldLabel htmlFor={id} className="cursor-pointer font-normal">
                {section.displayLabel ?? resolveI18n(section.name)}
              </FieldLabel>
            </div>
          );
        })}
      </div>
    </div>
  );
}
