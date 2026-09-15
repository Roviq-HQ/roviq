'use client';

import type { AcademicYearStatus } from '@roviq/graphql/generated';
import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from '@roviq/ui';
import {
  type AcademicYear,
  useAcademicYears,
} from '@web/app/[locale]/institute/(dashboard)/academic-years/use-academic-years';
import { CalendarRange, Check, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import * as React from 'react';

const STATUS_COLORS: Record<AcademicYearStatus, string> = {
  PLANNING: 'bg-sky-100 text-sky-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  COMPLETING: 'bg-amber-100 text-amber-700',
  ARCHIVED: 'bg-zinc-100 text-zinc-500',
};

/**
 * Shared resolver for the `?year=` selection. Both the picker and consuming
 * pages call this so they agree on the effective year. Seeds the URL with the
 * active year once it loads — without this, every page renders a null `yearId`
 * for a frame (the "select a year first" flash that broke report-cards) and
 * deep-links/refreshes never resolve a year.
 */
function useAcademicYearSelection() {
  const { years, loading } = useAcademicYears();
  const [selectedId, setSelectedId] = useQueryState('year', parseAsString);

  const activeYear = years.find((y) => y.isActive);
  const effectiveId = selectedId ?? activeYear?.id ?? null;

  React.useEffect(() => {
    if (!selectedId && activeYear) setSelectedId(activeYear.id, { history: 'replace' });
  }, [selectedId, activeYear, setSelectedId]);

  return {
    years,
    loading,
    effectiveId,
    setSelectedId,
    selectedYear: years.find((y) => y.id === effectiveId) ?? null,
  };
}

/**
 * Same effective-year rule as the URL hook (explicit choice, else the active
 * year) but held in component state — nothing is read from or written to the
 * URL. Timetable pages use this so `?year=` never appears or leaks there.
 */
export function useLocalAcademicYear() {
  const { years, loading } = useAcademicYears();
  const [overrideId, setOverrideId] = React.useState<string | null>(null);

  const activeYear = years.find((y) => y.isActive);
  const effectiveId = overrideId ?? activeYear?.id ?? null;

  return {
    yearId: effectiveId,
    year: years.find((y) => y.id === effectiveId) ?? null,
    years,
    loading,
    setYearId: setOverrideId,
  };
}

function YearDropdown({
  years,
  loading,
  effectiveId,
  selectedYear,
  onSelect,
}: {
  years: AcademicYear[];
  loading: boolean;
  effectiveId: string | null;
  selectedYear: AcademicYear | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('academicYears');

  if (loading || years.length === 0) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2 font-normal">
        <CalendarRange className="size-4" />
        <span className="text-muted-foreground">{t('selectYear')}</span>
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 font-normal">
          <CalendarRange className="size-4" />
          <span>{selectedYear?.label ?? t('selectYear')}</span>
          {selectedYear?.isActive && (
            <Badge
              variant="secondary"
              className="ms-1 px-1.5 py-0 text-[10px] font-medium bg-emerald-100 text-emerald-700 border-0"
            >
              {t('activeYear')}
            </Badge>
          )}
          <ChevronsUpDown className="ms-auto size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        <div className="space-y-0.5">
          {years.map((year) => (
            <button
              key={year.id}
              type="button"
              onClick={() => onSelect(year.id)}
              className={`
                w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-start
                transition-colors hover:bg-accent
                ${effectiveId === year.id ? 'bg-accent' : ''}
              `}
            >
              {effectiveId === year.id ? (
                <Check className="size-3.5 text-primary" />
              ) : (
                <span className="size-3.5" />
              )}
              <span className="flex-1 font-medium">{year.label}</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[year.status] ?? ''}`}
              >
                {t(`status.${year.status}`)}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Academic year selector — persistent dropdown stored in the URL via nuqs.
 * Used across academic-years, academics, and examinations pages.
 * Defaults to the active year when no year is selected.
 */
export function AcademicYearSelector() {
  const { years, loading, effectiveId, setSelectedId, selectedYear } = useAcademicYearSelection();

  return (
    <YearDropdown
      years={years}
      loading={loading}
      effectiveId={effectiveId}
      selectedYear={selectedYear}
      onSelect={(id) => void setSelectedId(id)}
    />
  );
}

/**
 * Controlled year selector — same dropdown, but the selection lives in the
 * caller's state instead of the URL. Pair with `useLocalAcademicYear`.
 */
export function ControlledAcademicYearSelector({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { years, loading } = useAcademicYears();
  const effectiveId = value ?? years.find((y) => y.isActive)?.id ?? null;

  return (
    <YearDropdown
      years={years}
      loading={loading}
      effectiveId={effectiveId}
      selectedYear={years.find((y) => y.id === effectiveId) ?? null}
      onSelect={onChange}
    />
  );
}

/**
 * Reads the currently selected academic year from the URL. `loading` lets
 * callers show a spinner while years load instead of falsely rendering the
 * "select a year first" empty state.
 */
export function useSelectedAcademicYear() {
  const { years, loading, effectiveId } = useAcademicYearSelection();

  return {
    yearId: effectiveId,
    year: years.find((y) => y.id === effectiveId) ?? null,
    loading,
  };
}
