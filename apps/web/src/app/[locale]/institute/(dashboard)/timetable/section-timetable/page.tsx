'use client';

import { useFormatDate } from '@roviq/i18n';
import { Button, Can, Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { StandardSectionSelect } from '@web/components/pickers/standard-section-select';
import { CalendarClock, Download, Loader2, Printer } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { AcademicYearSelector, useSelectedAcademicYear } from '../../academic-years/year-selector';
import { ReadOnlyGrid } from '../read-only-grid';
import { downloadBase64Pdf } from '../timetable-shared';
import { useSectionTimetable, useSectionTimetablePdf } from '../use-timetable';
import { TimetableLookupsProvider } from '../use-timetable-lookups';

const { instituteTimetable } = testIds;

export default function SectionTimetablePage() {
  const t = useTranslations('timetable');
  const { yearId } = useSelectedAcademicYear();
  const { format } = useFormatDate();
  const searchParams = useSearchParams();
  // Deep-link support: ?section=…&standard=… (from academics / student detail).
  const [sectionId, setSectionId] = React.useState<string | null>(() =>
    searchParams.get('section'),
  );
  const initialStandardId = searchParams.get('standard');
  const { grid, loading } = useSectionTimetable(sectionId);
  const [fetchPdf, { loading: pdfLoading }] = useSectionTimetablePdf();

  const handleDownloadPdf = React.useCallback(async () => {
    if (!sectionId) return;
    try {
      const { data } = await fetchPdf({ variables: { sectionId } });
      if (data?.sectionTimetablePdf) {
        downloadBase64Pdf(data.sectionTimetablePdf, 'section-timetable.pdf');
      }
    } catch {
      toast.error(t('view.downloadFailed'));
    }
  }, [fetchPdf, sectionId, t]);

  return (
    <Can I="read" a="Timetable" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <TimetableLookupsProvider academicYearId={yearId}>
            <div className="space-y-6" data-testid={instituteTimetable.sectionTimetablePage}>
              <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
                <h1
                  className="text-2xl font-semibold tracking-tight"
                  data-testid={instituteTimetable.sectionTimetableTitle}
                >
                  {t('view.sectionTitle')}
                </h1>
                <div className="flex items-center gap-3">
                  <AcademicYearSelector />
                  {grid && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleDownloadPdf}
                        disabled={pdfLoading}
                        title={t('view.downloadPdf')}
                        data-testid={instituteTimetable.downloadPdfButton}
                      >
                        {pdfLoading ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Download className="size-4" />
                        )}
                        {t('view.downloadPdf')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => window.print()}
                        title={t('view.print')}
                        data-testid={instituteTimetable.printButton}
                      >
                        <Printer className="size-4" /> {t('view.print')}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="print:hidden">
                <StandardSectionSelect
                  academicYearId={yearId}
                  sectionId={sectionId}
                  onSectionChange={setSectionId}
                  initialStandardId={initialStandardId}
                  standardTestId={instituteTimetable.sectionStandardSelect}
                  sectionTestId={instituteTimetable.sectionSelect}
                />
              </div>

              {!sectionId ? (
                <Empty className="print:hidden">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CalendarClock />
                    </EmptyMedia>
                    <EmptyTitle>{t('view.pickSection')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : loading ? (
                <div className="h-48 flex items-center justify-center">
                  <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              ) : !grid ? (
                <Empty className="print:hidden">
                  <EmptyHeader>
                    <EmptyTitle>{t('view.noTimetable')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="space-y-3">
                  <p className="hidden text-sm text-muted-foreground print:block">
                    {t('view.printedOn', { date: format(new Date(), 'dd/MM/yyyy') })}
                  </p>
                  <ReadOnlyGrid grid={grid} testId={instituteTimetable.sectionGrid} />
                </div>
              )}
            </div>
          </TimetableLookupsProvider>
        ) : (
          <div className="flex items-center justify-center min-h-[400px]">
            <p className="text-muted-foreground">{t('accessDenied')}</p>
          </div>
        )
      }
    </Can>
  );
}
