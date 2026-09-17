'use client';

import { extractGraphQLError } from '@roviq/graphql';
import {
  Button,
  Can,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Download, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { downloadBase64Pdf } from '../../download-pdf';
import { ResultStatusBadge } from '../../status-badge';
import { useMyReportCards, useReportCardPdf } from '../../use-examinations';

const { instituteExaminations: ex } = testIds;

export default function MyReportCardsPage() {
  const t = useTranslations('examinations');
  const { instances, loading } = useMyReportCards();
  const [fetchPdf] = useReportCardPdf();

  const handleDownload = async (instanceId: string, studentName: string) => {
    try {
      const { data } = await fetchPdf({ variables: { instanceId } });
      if (data?.reportCardPdf)
        downloadBase64Pdf(data.reportCardPdf, `report-card-${studentName}.pdf`);
    } catch (err) {
      toast.error(extractGraphQLError(err, t('reportCards.downloadFailed')));
    }
  };

  return (
    <Can I="read" a="ReportCard" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-6" data-testid={ex.myReportCardsPage}>
            <div>
              <h1
                className="text-2xl font-semibold tracking-tight"
                data-testid={ex.myReportCardsTitle}
              >
                {t('reportCards.myTitle')}
              </h1>
              <p className="text-sm text-muted-foreground">{t('reportCards.myDescription')}</p>
            </div>

            {loading ? (
              <CardsSkeleton />
            ) : instances.length === 0 ? (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle data-testid={ex.myReportCardsEmpty}>
                    {t('emptyStates.noMyReportCardsTitle')}
                  </EmptyTitle>
                  <EmptyDescription>{t('emptyStates.noMyReportCardsDescription')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {instances.map((inst) => (
                  <Card key={inst.id} data-testid={ex.myReportCardRow(inst.id)}>
                    <CardContent className="space-y-3 pt-6">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <p className="font-medium">{inst.payload.student.name}</p>
                          {inst.payload.termName && (
                            <p className="text-xs text-muted-foreground">
                              {t('reportCards.term')}: {inst.payload.termName}
                            </p>
                          )}
                        </div>
                        <ResultStatusBadge status={inst.resultStatus} />
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="tabular-nums">{inst.percentage ?? '—'}%</span>
                        <span>·</span>
                        <span>{inst.grade ?? '—'}</span>
                        {inst.rank != null && (
                          <>
                            <span>·</span>
                            <span>
                              {t('results.rank')} {inst.rank}
                            </span>
                          </>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        title={t('reportCards.download')}
                        onClick={() => handleDownload(inst.id, inst.payload.student.name)}
                        data-testid={ex.myReportCardDownloadBtn(inst.id)}
                      >
                        <Download className="size-3.5" /> {t('reportCards.download')}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-[400px] items-center justify-center">
            <p className="text-muted-foreground">{t('accessDenied')}</p>
          </div>
        )
      }
    </Can>
  );
}

function CardsSkeleton() {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      data-testid={ex.myReportCardsSkeleton}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cards
        <Skeleton key={i} className="h-36 w-full" />
      ))}
    </div>
  );
}
