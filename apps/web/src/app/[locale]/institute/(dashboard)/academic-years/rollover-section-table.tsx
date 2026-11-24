'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  type RolloverMove,
  type RolloverPreview,
  type RolloverSection,
  useSetRolloverSectionMap,
} from './use-academic-years';

const { instituteAcademicYears } = testIds;

const AUTOMATIC = 'automatic';

const isOver = (section: RolloverSection) =>
  section.currentStrength + section.incoming > section.capacity;

/**
 * One row per section of the active year: where its students go when the year is activated,
 * with a select to send them to another section of the same class. A change is saved at once
 * and the preview is loaded again, so the sizes shown are always the server's.
 */
export function RolloverSectionTable({
  academicYearId,
  preview,
}: {
  academicYearId: string;
  preview: RolloverPreview;
}) {
  const t = useTranslations('academicYears.rolloverPreview.sections');
  const tError = useTranslations('error');
  const resolveI18n = useI18nField();
  const { setSectionTarget, loading } = useSetRolloverSectionMap();

  if (preview.moves.length === 0) return null;

  const label = (
    standard: RolloverSection['standardName'],
    section: RolloverSection['sectionName'],
  ) => t('sectionLabel', { standard: resolveI18n(standard), section: resolveI18n(section) });
  const sectionById = new Map(preview.sections.map((s) => [s.sectionId, s]));
  const targetLabel = (sectionId: string) => {
    const section = sectionById.get(sectionId);
    return section ? label(section.standardName, section.sectionName) : '';
  };

  // The API lists a section's largest group first: that one gets the select.
  const rows = new Map<string, RolloverMove[]>();
  for (const move of preview.moves) {
    rows.set(move.fromSectionId, [...(rows.get(move.fromSectionId) ?? []), move]);
  }
  const over = preview.sections.filter(isOver);

  const handleChange = async (fromSectionId: string, value: string) => {
    try {
      await setSectionTarget(academicYearId, {
        fromSectionId,
        toSectionId: value === AUTOMATIC ? null : value,
      });
      toast.success(t('saved'));
    } catch (err) {
      const code = extractGraphQLErrorCode(err);
      toast.error(code && tError.has(code) ? tError(code) : tError('errorDescription'));
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="font-medium">{t('title')}</h3>
      <p className="text-muted-foreground">{t('description')}</p>
      {over.length > 0 && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          data-testid={instituteAcademicYears.activateCapacityWarning}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('capacityWarning', {
            count: over.length,
            capacity: over[0].capacity,
            sections: over
              .map((s) =>
                t('sectionWithSize', {
                  section: label(s.standardName, s.sectionName),
                  size: s.currentStrength + s.incoming,
                }),
              )
              .join(', '),
          })}
        </p>
      )}
      <Table aria-busy={loading} data-testid={instituteAcademicYears.activateSectionTable}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('from')}</TableHead>
            <TableHead className="text-end">{t('students')}</TableHead>
            <TableHead>{t('goesTo')}</TableHead>
            <TableHead className="text-end">{t('sizeAfter')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...rows.entries()].map(([fromSectionId, [main, ...others]]) => {
            const fromLabel = label(main.fromStandardName, main.fromSectionName);
            const target = main.toSectionId ? sectionById.get(main.toSectionId) : undefined;
            const options = preview.sections.filter((s) => s.standardId === main.toStandardId);
            return (
              <TableRow
                key={fromSectionId}
                data-testid={instituteAcademicYears.activateSectionRow(fromSectionId)}
              >
                <TableCell className="align-top font-medium">{fromLabel}</TableCell>
                <TableCell className="text-end align-top tabular-nums">{main.students}</TableCell>
                <TableCell className="space-y-1 align-top">
                  {target ? (
                    <Select
                      value={target.sectionId}
                      disabled={loading}
                      onValueChange={(value) => handleChange(fromSectionId, value)}
                    >
                      <SelectTrigger
                        className="h-8 w-full min-w-36"
                        aria-label={t('selectLabel', { section: fromLabel })}
                        data-testid={instituteAcademicYears.activateSectionSelect(fromSectionId)}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {main.overridden && (
                          <SelectItem
                            value={AUTOMATIC}
                            data-testid={instituteAcademicYears.activateSectionOption(AUTOMATIC)}
                          >
                            {t('automatic')}
                          </SelectItem>
                        )}
                        {options.map((s) => (
                          <SelectItem
                            key={s.sectionId}
                            value={s.sectionId}
                            data-testid={instituteAcademicYears.activateSectionOption(s.sectionId)}
                          >
                            {label(s.standardName, s.sectionName)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">{t('noClass')}</span>
                  )}
                  {others.length > 0 && (
                    <ul
                      className="text-muted-foreground text-xs"
                      data-testid={instituteAcademicYears.activateSectionOther(fromSectionId)}
                    >
                      {others.map((move) => (
                        <li key={move.toSectionId ?? 'none'}>
                          {move.toSectionId
                            ? t('alsoGoes', {
                                count: move.students,
                                section: targetLabel(move.toSectionId),
                              })
                            : t('alsoNoClass', { count: move.students })}
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell
                  className="text-end align-top tabular-nums"
                  data-testid={instituteAcademicYears.activateSectionSize(fromSectionId)}
                >
                  {target && (
                    <span
                      className={
                        isOver(target)
                          ? 'inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300'
                          : undefined
                      }
                    >
                      {isOver(target) && (
                        <AlertTriangle className="size-3.5" aria-label={t('overLimit')} />
                      )}
                      {t('size', {
                        size: target.currentStrength + target.incoming,
                        capacity: target.capacity,
                      })}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
