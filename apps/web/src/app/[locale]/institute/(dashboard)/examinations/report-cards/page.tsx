'use client';

import { extractGraphQLError } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import {
  Button,
  Can,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  AcademicYearSelector,
  useSelectedAcademicYear,
} from '@web/components/pickers/academic-year-picker';
import { StandardSectionSelect } from '@web/components/pickers/standard-section-select';
import { CalendarClock, Download, FileText, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { downloadBase64Pdf } from '../download-pdf';
import { ReportCardStatusBadge, ResultStatusBadge } from '../status-badge';
import {
  type ReportCard,
  useCreateReportCard,
  useExamTerms,
  useGenerateReportCards,
  useGradingSchemes,
  usePublishReportCards,
  useReportCardInstances,
  useReportCardPdf,
  useReportCards,
} from '../use-examinations';

const { instituteExaminations: ex } = testIds;

export default function ReportCardsPage() {
  const t = useTranslations('examinations');
  const { yearId, loading: yearLoading } = useSelectedAcademicYear();
  const resolveI18n = useI18nField();
  const { reportCards, loading } = useReportCards(yearId);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<ReportCard | null>(null);

  return (
    <Can I="read" a="ReportCard" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-6" data-testid={ex.reportCardsPage}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1
                  className="text-2xl font-semibold tracking-tight"
                  data-testid={ex.reportCardsTitle}
                >
                  {t('reportCards.title')}
                </h1>
                <p className="text-sm text-muted-foreground">{t('reportCards.description')}</p>
              </div>
              <div className="flex items-center gap-3">
                <AcademicYearSelector />
                <Can I="manage" a="ReportCard">
                  <Button
                    className="gap-2"
                    disabled={!yearId}
                    onClick={() => setCreateOpen(true)}
                    data-testid={ex.reportCardsCreateBtn}
                  >
                    <Plus className="size-4" /> {t('reportCards.create')}
                  </Button>
                </Can>
              </div>
            </div>

            {yearLoading ? (
              <CardsSkeleton />
            ) : !yearId ? (
              <NoYearState />
            ) : loading ? (
              <CardsSkeleton />
            ) : reportCards.length === 0 ? (
              <NoReportCardsState onCreate={() => setCreateOpen(true)} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {reportCards.map((rc) => (
                  <button
                    key={rc.id}
                    type="button"
                    className={`rounded-md border p-4 text-start transition-colors hover:border-primary ${selected?.id === rc.id ? 'border-primary bg-accent/40' : ''}`}
                    onClick={() => setSelected(rc)}
                    data-testid={ex.reportCardRow(rc.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{resolveI18n(rc.name)}</p>
                      <ReportCardStatusBadge
                        status={rc.status}
                        testId={ex.reportCardRowStatus(rc.id)}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        rc.includeAttendance && t('reportCards.includeAttendance'),
                        rc.includeTopicWise && t('reportCards.includeTopicWise'),
                        rc.includeCoScholastic && t('reportCards.includeCoScholastic'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {selected && yearId && <ReportCardPanel card={selected} academicYearId={yearId} />}

            {createOpen && yearId && (
              <CreateReportCardDialog
                academicYearId={yearId}
                open={createOpen}
                onOpenChange={setCreateOpen}
              />
            )}
          </div>
        ) : (
          <AccessDenied />
        )
      }
    </Can>
  );
}

function ReportCardPanel({ card, academicYearId }: { card: ReportCard; academicYearId: string }) {
  const t = useTranslations('examinations');
  const { generate, loading: generating } = useGenerateReportCards();
  const { publish, loading: publishing } = usePublishReportCards();
  const { instances, refetch } = useReportCardInstances(card.id);
  const [fetchPdf] = useReportCardPdf();
  const [sectionId, setSectionId] = React.useState<string | null>(null);

  const handleGenerate = async () => {
    if (!sectionId) return;
    try {
      const res = await generate(card.id, sectionId);
      const count =
        (res?.data as { generateReportCards?: number } | undefined)?.generateReportCards ?? 0;
      toast.success(t('reportCards.generated', { count }));
      await refetch();
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.REPORT_CARD_GENERATION_FAILED')));
    }
  };

  const handlePublish = async () => {
    try {
      const res = await publish(card.id);
      const count =
        (res?.data as { publishReportCards?: number } | undefined)?.publishReportCards ?? 0;
      toast.success(t('reportCards.published', { count }));
      await refetch();
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };

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
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <StandardSectionSelect
          academicYearId={academicYearId}
          sectionId={sectionId}
          onSectionChange={setSectionId}
          standardTestId="report-card-gen-standard"
          sectionTestId="report-card-gen-section"
        />
        <Can I="manage" a="ReportCard">
          <Button
            disabled={!sectionId || generating}
            onClick={handleGenerate}
            data-testid={ex.reportCardGenerateBtn(card.id)}
          >
            {generating ? t('saving') : t('reportCards.generateForSection')}
          </Button>
          <Button
            variant="outline"
            disabled={publishing || instances.length === 0}
            onClick={handlePublish}
            data-testid={ex.reportCardPublishBtn(card.id)}
          >
            {publishing ? t('saving') : t('reportCards.publish')}
          </Button>
        </Can>
      </div>

      {instances.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('reportCards.instances')}: 0</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>{t('results.rank')}</TableHead>
                <TableHead>{t('marks.student')}</TableHead>
                <TableHead>{t('results.percentage')}</TableHead>
                <TableHead>{t('results.grade')}</TableHead>
                <TableHead>{t('results.result')}</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {instances.map((inst) => (
                <TableRow key={inst.id} data-testid={ex.reportCardInstanceRow(inst.id)}>
                  <TableCell className="tabular-nums">{inst.rank ?? '—'}</TableCell>
                  <TableCell>{inst.payload.student.name}</TableCell>
                  <TableCell className="tabular-nums">{inst.percentage ?? '—'}%</TableCell>
                  <TableCell>{inst.grade ?? '—'}</TableCell>
                  <TableCell>
                    <ResultStatusBadge status={inst.resultStatus} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      title={t('reportCards.download')}
                      onClick={() => handleDownload(inst.id, inst.payload.student.name)}
                      data-testid={ex.reportCardDownloadBtn(inst.id)}
                    >
                      <Download className="size-3.5" /> {t('reportCards.download')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CreateReportCardDialog({
  academicYearId,
  open,
  onOpenChange,
}: {
  academicYearId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const { createReportCard, loading } = useCreateReportCard();
  const { terms } = useExamTerms(academicYearId);
  const { schemes } = useGradingSchemes('SCHOLASTIC');
  const [name, setName] = React.useState('');
  const [termId, setTermId] = React.useState('');
  const [schemeId, setSchemeId] = React.useState('');
  const [incAttendance, setIncAttendance] = React.useState(true);
  const [incCo, setIncCo] = React.useState(true);
  const [incTopic, setIncTopic] = React.useState(true);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    try {
      await createReportCard({
        academicYearId,
        name: { en: name.trim() },
        examTermId: termId || null,
        gradingSchemeId: schemeId || null,
        includeAttendance: incAttendance,
        includeCoScholastic: incCo,
        includeTopicWise: incTopic,
      });
      toast.success(t('reportCards.created'));
      onOpenChange(false);
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('reportCards.create')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field>
            <FieldLabel htmlFor="rc-name">{t('name')}</FieldLabel>
            <Input
              id="rc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid={ex.reportCardNameInput}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>{t('term')}</FieldLabel>
              <Select value={termId || undefined} onValueChange={setTermId}>
                <SelectTrigger data-testid={ex.reportCardTermSelect} aria-label={t('term')}>
                  <SelectValue placeholder={t('noTerm')} />
                </SelectTrigger>
                <SelectContent>
                  {terms.map((term) => (
                    <SelectItem key={term.id} value={term.id}>
                      {resolveI18n(term.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t('gradingScheme')}</FieldLabel>
              <Select value={schemeId || undefined} onValueChange={setSchemeId}>
                <SelectTrigger aria-label={t('gradingScheme')}>
                  <SelectValue placeholder={t('defaultScheme')} />
                </SelectTrigger>
                <SelectContent>
                  {schemes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {resolveI18n(s.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={incAttendance}
                onChange={(e) => setIncAttendance(e.target.checked)}
              />
              {t('reportCards.includeAttendance')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={incTopic}
                onChange={(e) => setIncTopic(e.target.checked)}
              />
              {t('reportCards.includeTopicWise')}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={incCo} onChange={(e) => setIncCo(e.target.checked)} />
              {t('reportCards.includeCoScholastic')}
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            disabled={loading || !name.trim()}
            onClick={handleSubmit}
            data-testid={ex.reportCardSubmitBtn}
          >
            {loading ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoYearState() {
  const t = useTranslations('examinations');
  return (
    <Empty data-testid={ex.reportCardsEmpty}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarClock aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('emptyStates.noYearTitle')}</EmptyTitle>
        <EmptyDescription>{t('emptyStates.noYearDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function NoReportCardsState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('examinations');
  return (
    <Empty data-testid={ex.reportCardsEmpty}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileText aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('emptyStates.noReportCardsTitle')}</EmptyTitle>
        <EmptyDescription>{t('emptyStates.noReportCardsDescription')}</EmptyDescription>
      </EmptyHeader>
      <Can I="manage" a="ReportCard">
        <EmptyContent>
          <Button className="gap-2" onClick={onCreate} data-testid={ex.reportCardsEmptyCreateBtn}>
            <Plus className="size-4" /> {t('reportCards.create')}
          </Button>
        </EmptyContent>
      </Can>
    </Empty>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid={ex.reportCardsSkeleton}>
      {Array.from({ length: 6 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cards
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function AccessDenied() {
  const t = useTranslations('examinations');
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <p className="text-muted-foreground">{t('accessDenied')}</p>
    </div>
  );
}
