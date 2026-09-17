'use client';

import { extractGraphQLError } from '@roviq/graphql';
import { Link, useFormatDate, useI18nField } from '@roviq/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  buttonVariants,
  Calendar,
  Can,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
  useBreadcrumbOverride,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { StandardSectionSelect } from '@web/components/pickers/standard-section-select';
import { parseISO } from 'date-fns';
import {
  Archive,
  ArchiveRestore,
  CalendarIcon,
  CalendarOff,
  CalendarX2,
  ChevronDown,
  ChevronRight,
  Download,
  Pencil,
  PencilLine,
  Plus,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import {
  type Section,
  type Standard,
  type Subject,
  useSectionsByAcademicYear,
  useStandards,
  useSubjectsByStandard,
} from '../../academics/use-academics';
import { useHolidays } from '../../holiday/use-holiday';
import { useStaff } from '../../people/staff/use-staff';
import { downloadBase64Pdf } from '../download-pdf';
import { ExamStatusBadge } from '../status-badge';
import {
  ASSESSMENT_COMPONENTS,
  type AssessmentComponent,
  type Exam,
  type ExamSchedule,
  type ExamStatus,
  useAddExamSchedule,
  useAllSubjects,
  useEnterExamMarks,
  useExam,
  useExamDatesheet,
  useExamDatesheetPdf,
  useExamLifecycle,
  useExamMarksSheet,
  useRemoveExamSchedule,
  useUnarchiveExam,
  useUpdateExam,
  useUpdateExamSchedule,
} from '../use-examinations';

const { instituteExaminations: ex } = testIds;

// Radix <Select> can't hold an empty value, so the "unassigned" option uses this sentinel.
const NO_INVIGILATOR = '__none__';
// Same constraint for the designer's class filter — the "All classes" option needs a value.
const ALL_CLASSES = '__all__';

export default function ExamDetailPage() {
  const params = useParams();
  const examId = params.examId as string;
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const { exam, loading } = useExam(examId);
  // Show the exam name in the breadcrumb instead of the raw UUID segment.
  useBreadcrumbOverride(exam ? { [examId]: resolveI18n(exam.name) } : {});

  // Datesheet view + PDF state live here so the header box can render the actions.
  const { schedules } = useExamDatesheet(examId);
  const [fetchPdf, { loading: pdfLoading }] = useExamDatesheetPdf();
  // "Edit datesheet" opens the designer in a large dialog instead of swapping the page view.
  const [designerOpen, setDesignerOpen] = React.useState(false);

  const examName = exam ? resolveI18n(exam.name) : '';
  const handleDownload = async () => {
    try {
      const { data } = await fetchPdf({ variables: { examId } });
      if (data?.examDatesheetPdf)
        downloadBase64Pdf(data.examDatesheetPdf, `datesheet-${examName}.pdf`);
    } catch (err) {
      toast.error(extractGraphQLError(err, t('datesheet.downloadFailed')));
    }
  };

  const downloadAndEditActions = (
    <>
      {schedules.length > 0 && (
        <Can I="read" a="Exam">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={pdfLoading}
            onClick={handleDownload}
            title={t('datesheet.download')}
            data-testid={ex.datesheetDownloadBtn}
          >
            <Download className="size-3.5" /> {t('datesheet.download')}
          </Button>
        </Can>
      )}
      <Can I="update" a="Exam">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setDesignerOpen(true)}
          title={t('datesheet.editDatesheet')}
          data-testid={ex.editDatesheetBtn}
        >
          <PencilLine className="size-3.5" /> {t('datesheet.editDatesheet')}
        </Button>
      </Can>
    </>
  );

  if (loading) return <DetailSkeleton />;
  if (!exam) {
    return (
      <Empty data-testid={ex.emptyState}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarX2 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t('emptyStates.noExamsTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyStates.noExamsDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Can I="read" a="Exam" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-6" data-testid={ex.detailPage}>
            {/* Desktop: title left, action box right on the same row; mobile: stacked. */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                {/* No back link — the breadcrumb already navigates to Examinations. */}
                <h1 className="text-2xl font-semibold tracking-tight" data-testid={ex.detailTitle}>
                  {resolveI18n(exam.name)}
                </h1>
              </div>
              <div
                className="rounded-md border bg-muted/30 px-3 py-2"
                data-testid={ex.detailStatus}
              >
                <Lifecycle exam={exam} t={t} beforeArchive={downloadAndEditActions} />
              </div>
            </div>

            <Datesheet
              examId={examId}
              examStatus={exam.status}
              academicYearId={exam.academicYearId}
              startDate={exam.startDate}
              endDate={exam.endDate}
              schedules={schedules}
              designerOpen={designerOpen}
              setDesignerOpen={setDesignerOpen}
            />
          </div>
        ) : (
          <AccessDenied />
        )
      }
    </Can>
  );
}

function Lifecycle({
  exam,
  t,
  beforeArchive,
}: {
  exam: Exam;
  t: ReturnType<typeof useTranslations<'examinations'>>;
  // Slot rendered right before the Archive/Unarchive button (Download + Edit datesheet).
  beforeArchive?: React.ReactNode;
}) {
  const { schedule, openMarksEntry, lock, publishResults, archive } = useExamLifecycle();
  const { unarchive } = useUnarchiveExam();
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };
  const s = exam.status;
  // Content-sized row: badge then actions; the header box on the right hugs it.
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Published exams swap the status badge for a link to the dedicated results page. */}
      {s === 'RESULTS_PUBLISHED' ? (
        <Link
          href={`/institute/examinations/${exam.id}/results`}
          className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'gap-1.5')}
          title={t('results.view')}
          data-testid={ex.resultsLink}
        >
          <Trophy className="size-3.5" /> {t('results.view')}
        </Link>
      ) : (
        <ExamStatusBadge status={s} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Can I="update" a="Exam">
          {s === 'DRAFT' && (
            <Button
              size="sm"
              title={t('lifecycle.schedule')}
              onClick={() => run(() => schedule(exam.id), t('lifecycle.scheduled'))}
              data-testid={ex.scheduleBtn}
            >
              {t('lifecycle.schedule')}
            </Button>
          )}
          {s === 'SCHEDULED' && (
            <Button
              size="sm"
              title={t('lifecycle.openMarksEntry')}
              onClick={() => run(() => openMarksEntry(exam.id), t('lifecycle.marksOpened'))}
              data-testid={ex.openMarksBtn}
            >
              {t('lifecycle.openMarksEntry')}
            </Button>
          )}
          {s === 'MARKS_ENTRY' && (
            <Button
              size="sm"
              title={t('lifecycle.lock')}
              onClick={() => run(() => lock(exam.id), t('lifecycle.locked'))}
              data-testid={ex.lockBtn}
            >
              {t('lifecycle.lock')}
            </Button>
          )}
          {s === 'LOCKED' && (
            <>
              <Button
                size="sm"
                variant="outline"
                title={t('lifecycle.openMarksEntry')}
                onClick={() => run(() => openMarksEntry(exam.id), t('lifecycle.marksOpened'))}
                data-testid={ex.openMarksBtn}
              >
                {t('lifecycle.openMarksEntry')}
              </Button>
              <Button
                size="sm"
                title={t('lifecycle.publishResults')}
                onClick={() => run(() => publishResults(exam.id), t('lifecycle.resultsPublished'))}
                data-testid={ex.publishResultsBtn}
              >
                {t('lifecycle.publishResults')}
              </Button>
            </>
          )}
        </Can>
        {/* Download + Edit datesheet sit between the transition buttons and Archive. */}
        {beforeArchive}
        <Can I="update" a="Exam">
          {s === 'ARCHIVED' ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              title={t('lifecycle.unarchive')}
              onClick={() => run(() => unarchive(exam.id), t('lifecycle.unarchived'))}
              data-testid={ex.unarchiveBtn}
            >
              <ArchiveRestore className="size-3.5" /> {t('lifecycle.unarchive')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              title={t('lifecycle.archive')}
              onClick={() => run(() => archive(exam.id), t('lifecycle.archived'))}
              data-testid={ex.archiveBtn}
            >
              <Archive className="size-3.5" /> {t('lifecycle.archive')}
            </Button>
          )}
        </Can>
      </div>
    </div>
  );
}

// Sort by exam date then start time; null dates/times sink to the end so a
// printable datesheet always reads top-to-bottom in chronological order.
function sortDatesheet(rows: ExamSchedule[]): ExamSchedule[] {
  return [...rows].sort((a, b) => {
    const byDate = (a.examDate ?? '￿').localeCompare(b.examDate ?? '￿');
    if (byDate !== 0) return byDate;
    return (a.startTime ?? '￿').localeCompare(b.startTime ?? '￿');
  });
}

// Minutes between two "HH:mm[:ss]" times; null when either is missing.
function durationMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const toMins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const diff = toMins(end) - toMins(start);
  return diff > 0 ? diff : null;
}

// ── Datesheet designer (sections × dates matrix) ─────────────────────────────

type Shift = 'MORNING' | 'AFTERNOON' | 'EVENING';
const SHIFTS: Shift[] = ['MORNING', 'AFTERNOON', 'EVENING'];
// Quick-pick time windows; the dialog seeds start/end from these but stays editable.
const SHIFT_WINDOWS: Record<Shift, { start: string; end: string }> = {
  MORNING: { start: '09:00', end: '12:00' },
  AFTERNOON: { start: '13:00', end: '15:00' },
  EVENING: { start: '16:00', end: '18:00' },
};

// Inclusive list of ISO YYYY-MM-DD dates from start→end (UTC-safe).
function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// ISO day arithmetic (UTC-safe).
function addDaysISO(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// True when the next column is more than a day away — a fill-the-gap (+)
// cell renders between them.
function hasDateGap(dates: string[], i: number): boolean {
  const next = dates[i + 1];
  return next !== undefined && next !== addDaysISO(dates[i], 1);
}

function Datesheet({
  examId,
  examStatus,
  academicYearId,
  startDate,
  endDate,
  schedules,
  designerOpen,
  setDesignerOpen,
}: {
  examId: string;
  examStatus: ExamStatus;
  academicYearId: string;
  startDate: string | null;
  endDate: string | null;
  schedules: ExamSchedule[];
  designerOpen: boolean;
  setDesignerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const { loading } = useExamDatesheet(examId);
  const { removeSchedule } = useRemoveExamSchedule();
  const { staff } = useStaff();
  const { subjects } = useAllSubjects();
  // null = closed; 'add' = blank dialog; an ExamSchedule = edit that row pre-filled.
  const [dialog, setDialog] = React.useState<'add' | ExamSchedule | null>(null);
  const [marksFor, setMarksFor] = React.useState<string | null>(null);

  const sorted = React.useMemo(() => sortDatesheet(schedules), [schedules]);
  // Invigilator id on a schedule is a membership id (same as timetable teacherId).
  const invigilatorNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staff) {
      map.set(
        s.membershipId,
        `${resolveI18n(s.firstName)} ${resolveI18n(s.lastName ?? {})}`.trim(),
      );
    }
    return map;
  }, [staff, resolveI18n]);

  // Map subjectId → resolved name; fall back to a short id slice if not yet loaded.
  const subjectNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjects) map.set(s.id, resolveI18n(s.name));
    return map;
  }, [subjects, resolveI18n]);
  const subjectName = (id: string) => subjectNames.get(id) ?? id.slice(0, 8);

  const handleRemove = async (id: string) => {
    try {
      await removeSchedule(id);
      toast.success(t('datesheet.removed'));
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{t('datesheet.title')}</h2>

      <DatesheetList
        rows={sorted}
        loading={loading}
        examStatus={examStatus}
        subjectName={subjectName}
        invigilatorNames={invigilatorNames}
        onAdd={() => setDialog('add')}
        onEdit={setDialog}
        onRemove={handleRemove}
        onEnterMarks={setMarksFor}
      />

      {/* Designer matrix lives in a large dialog (full-screen on mobile) — it needs room. */}
      <Dialog open={designerOpen} onOpenChange={setDesignerOpen}>
        <DialogContent
          className="flex flex-col gap-0 p-0 sm:max-w-[95vw] lg:max-w-6xl max-h-[90vh] max-sm:h-[100dvh] max-sm:max-w-full max-sm:rounded-none"
          data-testid={ex.designerDialogShell}
        >
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{t('datesheet.editDatesheet')}</DialogTitle>
          </DialogHeader>
          {/* Flex column so the matrix fills + scrolls and the footer pins to the
              bottom (no empty band on the full-screen mobile dialog). */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
            <DatesheetDesigner
              examId={examId}
              academicYearId={academicYearId}
              startDate={startDate}
              endDate={endDate}
              schedules={schedules}
              subjectName={subjectName}
            />
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => setDesignerOpen(false)}
              title={t('datesheet.done')}
              data-testid={ex.designerBackBtn}
            >
              {t('datesheet.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialog && (
        <PaperDialog
          examId={examId}
          academicYearId={academicYearId}
          mode={dialog === 'add' ? 'add' : 'edit'}
          editing={dialog === 'add' ? null : dialog}
          subjectName={subjectName}
          open={!!dialog}
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
      {marksFor && (
        <MarksDialog
          examId={examId}
          examScheduleId={marksFor}
          open={!!marksFor}
          onOpenChange={(o) => !o && setMarksFor(null)}
        />
      )}
    </div>
  );
}

// Datesheet list view: the chronological table + right-aligned "Add subject".
// Extracted from Datesheet to keep that component within the complexity budget.
function DatesheetList({
  rows,
  loading,
  examStatus,
  subjectName,
  invigilatorNames,
  onAdd,
  onEdit,
  onRemove,
  onEnterMarks,
}: {
  rows: ExamSchedule[];
  loading: boolean;
  examStatus: ExamStatus;
  subjectName: (id: string) => string;
  invigilatorNames: Map<string, string>;
  onAdd: () => void;
  onEdit: (row: ExamSchedule) => void;
  onRemove: (id: string) => void;
  onEnterMarks: (id: string) => void;
}) {
  const t = useTranslations('examinations');
  const { format } = useFormatDate();

  return (
    <div className="space-y-4">
      {loading ? (
        <DatesheetSkeleton />
      ) : rows.length === 0 ? (
        <Empty className="border" data-testid={ex.datesheetEmpty}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarX2 aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t('emptyStates.noDatesheetTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyStates.noDatesheetDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border" data-testid={ex.datesheet}>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>{t('datesheet.date')}</TableHead>
                <TableHead>{t('datesheet.day')}</TableHead>
                <TableHead>{t('datesheet.subject')}</TableHead>
                <TableHead>{t('datesheet.component')}</TableHead>
                <TableHead>{t('datesheet.invigilator')}</TableHead>
                <TableHead>{t('datesheet.duration')}</TableHead>
                <TableHead>{t('datesheet.maxMarks')}</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const date = row.examDate ? new Date(row.examDate) : null;
                const mins = durationMinutes(row.startTime, row.endTime);
                return (
                  <TableRow key={row.id} data-testid={ex.scheduleRow(row.id)}>
                    <TableCell className="tabular-nums">
                      {date ? format(date, 'dd/MM/yyyy') : '—'}
                    </TableCell>
                    <TableCell>{date ? format(date, 'EEEE') : '—'}</TableCell>
                    <TableCell className="font-medium">{subjectName(row.subjectId)}</TableCell>
                    <TableCell>{t(`components.${row.component}`)}</TableCell>
                    <TableCell>
                      {row.invigilatorId ? (invigilatorNames.get(row.invigilatorId) ?? '—') : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {mins != null ? t('datesheet.durationMinutes', { minutes: mins }) : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.maxMarks}</TableCell>
                    <TableCell className="text-end">
                      {examStatus === 'MARKS_ENTRY' && (
                        <Can I="update" a="Exam">
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('marks.enter')}
                            onClick={() => onEnterMarks(row.id)}
                            data-testid={ex.enterMarksLink(row.id)}
                          >
                            {t('marks.enter')}
                          </Button>
                        </Can>
                      )}
                      <Can I="update" a="Exam">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('datesheet.edit')}
                          title={t('datesheet.edit')}
                          onClick={() => onEdit(row)}
                          data-testid={ex.scheduleEditBtn(row.id)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </Can>
                      <Can I="update" a="Exam">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={t('delete')}
                          title={t('delete')}
                          onClick={() => onRemove(row.id)}
                          data-testid={ex.scheduleDeleteBtn(row.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </Can>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {/* Add lives under the table, right-aligned to match the top action row. */}
      <Can I="update" a="Exam">
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onAdd}
            data-testid={ex.addScheduleBtn}
          >
            <Plus className="size-3.5" /> {t('datesheet.addRow')}
          </Button>
        </div>
      </Can>
    </div>
  );
}

// A teacher reads the datesheet as a poster: rows = sections (grouped by class),
// columns = dates. `target` opens the paper dialog scoped to one (section, date);
// `applyAll` true means the per-class date action — schedule the same paper across
// every section of that class. `standardId`/`sections` scope subjects + apply-all,
// since subjects differ per class.
interface DesignerTarget {
  standardId: string;
  sections: Section[];
  sectionId: string | null;
  sectionLabel: string;
  date: string;
  applyAll: boolean;
}

// Date picker + Add for a new matrix column. Only the picked date is added —
// never the span around it. A calendar popover (not a native date input) so
// the entry format is always dd/MM/yyyy regardless of browser locale — the
// native input's mm/dd/yyyy silently rejects typed Indian dates. Opens on
// the last column's month so extending forward needs no navigation. The
// caller decides what "add" persists (session columns vs establishing a
// missing exam range).
function DesignerAddDate({
  dates,
  onAdd,
}: {
  dates: string[];
  onAdd: (date: string) => void | Promise<void>;
}) {
  const t = useTranslations('examinations');
  const { format } = useFormatDate();
  const [newDate, setNewDate] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  const covered = newDate !== '' && dates.includes(newDate);

  const add = async () => {
    if (newDate === '' || covered) return;
    setBusy(true);
    try {
      await onAdd(newDate);
      setNewDate('');
      toast.success(t('designer.dateAdded'));
    } catch (err) {
      toast.error(extractGraphQLError(err, t('designer.addDateFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field>
      <FieldLabel htmlFor="designer-add-date">{t('designer.addDate')}</FieldLabel>
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              id="designer-add-date"
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 justify-start text-start font-normal"
              data-testid={ex.designerAddDateInput}
            >
              <CalendarIcon
                className="me-2 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              {newDate ? (
                format(parseISO(newDate), 'dd/MM/yyyy')
              ) : (
                <span className="text-muted-foreground">{t('designer.selectDate')}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={newDate ? parseISO(newDate) : undefined}
              defaultMonth={dates.length > 0 ? parseISO(dates[dates.length - 1]) : undefined}
              onSelect={(date) => {
                if (date) {
                  setNewDate(format(date, 'yyyy-MM-dd'));
                  setOpen(false);
                }
              }}
            />
          </PopoverContent>
        </Popover>
        {/* Hidden input mirrors the ISO value for screen readers, matching
            the academic-year dialog's date fields. */}
        <Input type="hidden" name="designer-add-date" value={newDate} readOnly />
        <Button
          size="sm"
          disabled={newDate === '' || covered || busy}
          title={t('designer.addDateHelp')}
          onClick={add}
          data-testid={ex.designerAddDateBtn}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {t('designer.addDateButton')}
        </Button>
      </div>
    </Field>
  );
}

export function DatesheetDesigner({
  examId,
  academicYearId,
  startDate,
  endDate,
  schedules,
  subjectName,
}: {
  examId: string;
  academicYearId: string;
  startDate: string | null;
  endDate: string | null;
  schedules: ExamSchedule[];
  subjectName: (id: string) => string;
}) {
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const { format } = useFormatDate();
  const { standards } = useStandards(academicYearId);
  // One bulk fetch for every section in the year, grouped by standard client-side —
  // replaces the old per-class useSections fan-out (~15 requests → 1).
  const { sections: allSections, loading: sectionsLoading } =
    useSectionsByAcademicYear(academicYearId);
  // null = "All classes" (default). Selecting one narrows the matrix to its sections.
  const [classFilter, setClassFilter] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<DesignerTarget | null>(null);
  // Session-only columns picked in the dialog. Papers placed on them persist
  // as schedules (so they survive reopen); empty ones don't.
  const [addedDates, setAddedDates] = React.useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const { updateExam } = useUpdateExam();
  // Header cells by date, so a newly added column scrolls into view instead
  // of landing off-screen with a "success" toast and nothing visible.
  const colRefs = React.useRef(new Map<string, HTMLTableCellElement>());
  const addedCountRef = React.useRef(0);
  React.useEffect(() => {
    if (addedDates.length > addedCountRef.current) {
      const last = addedDates[addedDates.length - 1];
      colRefs.current.get(last)?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
    addedCountRef.current = addedDates.length;
  }, [addedDates]);

  const sectionsByStandard = React.useMemo(() => {
    const map = new Map<string, Section[]>();
    for (const s of allSections) {
      const bucket = map.get(s.standardId);
      if (bucket) bucket.push(s);
      else map.set(s.standardId, [s]);
    }
    return map;
  }, [allSections]);

  const rangeDates = React.useMemo(
    () => (startDate && endDate ? datesInRange(startDate, endDate) : []),
    [startDate, endDate],
  );

  // Sparse columns: exam-range days, plus any scheduled-paper dates (papers
  // may sit outside the range), plus session-added dates. Adding a date never
  // fills the span around it, and never rewrites the exam range.
  const dates = React.useMemo(() => {
    const set = new Set<string>(rangeDates);
    for (const s of schedules) {
      if (s.examDate) set.add(s.examDate);
    }
    for (const d of addedDates) set.add(d);
    return [...set].sort();
  }, [rangeDates, schedules, addedDates]);

  const addDate = (date: string) =>
    setAddedDates((prev) => (prev.includes(date) ? prev : [...prev, date]));

  const removeDate = (date: string) => setAddedDates((prev) => prev.filter((d) => d !== date));

  // × shows only when clicking it can act: papers anchor their date (dropping
  // the column would strand them, cascade-deleting could destroy entered
  // marks), middle range days can't leave a hole in the span, and the last
  // range day would null the exam window.
  const canDeleteDate = (date: string): boolean => {
    if (schedules.some((s) => s.examDate === date)) return false;
    if (addedDates.includes(date)) return true;
    return (
      rangeDates.length > 1 &&
      rangeDates.includes(date) &&
      (date === rangeDates[0] || date === rangeDates[rangeDates.length - 1])
    );
  };

  const requestDeleteDate = (date: string) => {
    setDeleteTarget(date);
  };

  const confirmDeleteDate = async () => {
    if (!deleteTarget) {
      setDeleteTarget(null);
      return;
    }
    if (schedules.some((s) => s.examDate === deleteTarget)) {
      setDeleteTarget(null);
      toast.error(t('designer.cannotDeleteWithPapers'));
      return;
    }
    try {
      if (addedDates.includes(deleteTarget)) {
        removeDate(deleteTarget);
      } else if (rangeDates.includes(deleteTarget)) {
        // Range edge: shrink the persisted span to the remaining days.
        const remaining = rangeDates.filter((d) => d !== deleteTarget);
        if (remaining.length === 0) {
          setDeleteTarget(null);
          return;
        }
        if (deleteTarget === rangeDates[0]) {
          await updateExam(examId, { startDate: remaining[0] });
        } else {
          await updateExam(examId, { endDate: remaining[remaining.length - 1] });
        }
      }
      setDeleteTarget(null);
      toast.success(t('designer.dateRemoved'));
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };

  // Holiday lookup spans the exam range extended by added dates, so columns
  // outside the range still mute + warn like range days.
  const holidayBounds = React.useMemo(() => {
    const ends = [...(startDate && endDate ? [startDate, endDate] : []), ...addedDates].sort();
    return ends.length > 0
      ? { startDate: ends[0], endDate: ends[ends.length - 1] }
      : { startDate, endDate };
  }, [startDate, endDate, addedDates]);

  // Holidays overlapping the columns — mute those columns and warn on placement.
  const { holidays } = useHolidays(holidayBounds);
  const holidayByDate = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidays) {
      for (const d of datesInRange(h.startDate, h.endDate)) {
        if (dates.includes(d)) map.set(d, resolveI18n(h.name));
      }
    }
    return map;
  }, [holidays, dates, resolveI18n]);

  // Index every section's papers by `sectionId|date` for O(1) cell lookup across all classes.
  const papersByCell = React.useMemo(() => {
    const map = new Map<string, ExamSchedule[]>();
    for (const s of schedules) {
      if (!s.examDate) continue;
      const key = `${s.sectionId}|${s.examDate}`;
      const bucket = map.get(key);
      if (bucket) bucket.push(s);
      else map.set(key, [s]);
    }
    // Stable order: earliest start time first within a cell.
    for (const bucket of map.values()) {
      bucket.sort((a, b) => (a.startTime ?? '￿').localeCompare(b.startTime ?? '￿'));
    }
    return map;
  }, [schedules]);

  if (dates.length === 0) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4" data-testid={ex.designer}>
        <Can I="update" a="Exam">
          <DesignerAddDate
            dates={dates}
            onAdd={async (date) => {
              await updateExam(examId, { startDate: date, endDate: date });
            }}
          />
        </Can>
        <p className="text-sm text-muted-foreground">{t('designer.noDateRange')}</p>
      </div>
    );
  }

  const visibleStandards = classFilter ? standards.filter((s) => s.id === classFilter) : standards;

  // min-w-0 is load-bearing: without it the flex min-content rule inflates
  // this root to the table's full width, the matrix's own scrollbar never
  // engages, and right-side columns spill past the dialog unreachable.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4" data-testid={ex.designer}>
      <Field className="w-56">
        <FieldLabel>{t('designer.classFilter')}</FieldLabel>
        <Select
          value={classFilter ?? ALL_CLASSES}
          onValueChange={(v) => setClassFilter(v === ALL_CLASSES ? null : v)}
        >
          <SelectTrigger
            data-testid={ex.designerClassFilter}
            aria-label={t('designer.filterByClass')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CLASSES}>{t('designer.allClasses')}</SelectItem>
            {standards.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {resolveI18n(s.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {sectionsLoading ? (
        <div className="space-y-2 rounded-md border p-2" data-testid={ex.designerMatrix}>
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : standards.length === 0 ? (
        <Empty className="border" data-testid={ex.designerMatrix}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarX2 aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t('designer.noSectionsTitle')}</EmptyTitle>
            <EmptyDescription>{t('designer.noSectionsDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-auto rounded-md border"
          data-testid={ex.designerMatrix}
        >
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky start-0 top-0 z-30 min-w-[8rem] bg-muted px-3 py-2 text-start font-medium">
                  {t('designer.sectionColumn')}
                </th>
                {dates.map((date, i) => {
                  const holidayName = holidayByDate.get(date);
                  const dateObj = new Date(`${date}T00:00:00`);
                  const gapDate = hasDateGap(dates, i) ? addDaysISO(date, 1) : null;
                  return (
                    <React.Fragment key={date}>
                      <th
                        ref={(el) => {
                          if (el) colRefs.current.set(date, el);
                          else colRefs.current.delete(date);
                        }}
                        className={cn(
                          'sticky top-0 z-20 min-w-[10rem] border-s px-2 py-2 text-start align-top font-medium',
                          holidayName ? 'bg-muted' : 'bg-muted/50',
                          'relative',
                        )}
                      >
                        <span className="block tabular-nums">{format(dateObj, 'dd/MM/yyyy')}</span>
                        <span className="block text-xs font-normal text-muted-foreground">
                          {format(dateObj, 'EEEE')}
                        </span>
                        {holidayName ? (
                          <Badge
                            variant="secondary"
                            className="mt-1 gap-1 border-0 bg-rose-100 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                          >
                            <CalendarOff className="size-3" aria-hidden="true" />
                            {holidayName}
                          </Badge>
                        ) : null}
                        {canDeleteDate(date) && (
                          <Can I="update" a="Exam">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute end-1 top-1 size-5 text-muted-foreground hover:text-destructive"
                              title={t('designer.deleteDate')}
                              aria-label={t('designer.deleteDate')}
                              onClick={() => requestDeleteDate(date)}
                              data-testid={ex.designerDateDelete(date)}
                            >
                              <X className="size-3" aria-hidden="true" />
                            </Button>
                          </Can>
                        )}
                      </th>
                      {gapDate && (
                        <th
                          key={`gap-${date}`}
                          className="sticky top-0 z-20 w-10 px-0 py-2 text-center align-middle"
                          title={t('designer.addMissingDate', {
                            date: format(new Date(`${gapDate}T00:00:00`), 'dd/MM/yyyy'),
                          })}
                        >
                          <Can I="update" a="Exam">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              aria-label={t('designer.addMissingDate', {
                                date: format(new Date(`${gapDate}T00:00:00`), 'dd/MM/yyyy'),
                              })}
                              onClick={() => addDate(gapDate)}
                              data-testid={ex.designerDateGapAdd(gapDate)}
                            >
                              <Plus className="size-3.5" aria-hidden="true" />
                            </Button>
                          </Can>
                        </th>
                      )}
                    </React.Fragment>
                  );
                })}
                <th className="sticky top-0 z-20 min-w-[14rem] border-s bg-muted/50 px-2 py-2 text-start align-top font-medium">
                  <Can I="update" a="Exam">
                    <DesignerAddDate dates={dates} onAdd={addDate} />
                  </Can>
                </th>
              </tr>
            </thead>
            {visibleStandards.map((standard) => (
              <DesignerClassGroup
                key={standard.id}
                standard={standard}
                sections={sectionsByStandard.get(standard.id) ?? []}
                dates={dates}
                holidayByDate={holidayByDate}
                papersByCell={papersByCell}
                subjectName={subjectName}
                onOpenTarget={setTarget}
              />
            ))}
          </table>
        </div>
      )}

      {target && (
        <PaperDialog
          examId={examId}
          academicYearId={academicYearId}
          mode="add"
          preset={{
            standardId: target.standardId,
            sectionId: target.sectionId,
            sectionLabel: target.sectionLabel,
            date: target.date,
            sections: target.sections,
            isHoliday: !!holidayByDate.get(target.date),
            holidayName: holidayByDate.get(target.date) ?? null,
          }}
          subjectName={subjectName}
          existingPapers={
            target.sectionId ? (papersByCell.get(`${target.sectionId}|${target.date}`) ?? []) : []
          }
          open={!!target}
          onOpenChange={(o) => !o && setTarget(null)}
        />
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent data-testid={ex.designerDeleteDateDialog}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('designer.deleteDateTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? t(
                    deleteTarget && !addedDates.includes(deleteTarget)
                      ? 'designer.deleteDateShrinksRange'
                      : 'designer.deleteDateDescription',
                    {
                      date: format(new Date(`${deleteTarget}T00:00:00`), 'dd/MM/yyyy'),
                    },
                  )
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={ex.designerDeleteDateCancel}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteDate}
              data-testid={ex.designerDeleteDateConfirm}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// One class block: a collapsible group-header row + its section rows. Sections come
// from the parent's bulk fetch (grouped by standardId) — no per-class request here.
function DesignerClassGroup({
  standard,
  sections,
  dates,
  holidayByDate,
  papersByCell,
  subjectName,
  onOpenTarget,
}: {
  standard: Standard;
  sections: Section[];
  dates: string[];
  holidayByDate: Map<string, string>;
  papersByCell: Map<string, ExamSchedule[]>;
  subjectName: (id: string) => string;
  onOpenTarget: (target: DesignerTarget) => void;
}) {
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const [expanded, setExpanded] = React.useState(true);

  const sectionLabel = (s: Section) => s.displayLabel ?? resolveI18n(s.name);
  const className = resolveI18n(standard.name);
  // Section column + date columns + gap cells + trailing add-date column.
  const gapCount = dates.filter((_, i) => hasDateGap(dates, i)).length;
  const colSpan = dates.length + gapCount + 2;

  return (
    <tbody data-testid={ex.designerClassGroup(standard.id)}>
      <tr className="border-t bg-muted/40">
        <th className="sticky start-0 z-10 min-w-[8rem] bg-muted/40 px-2 py-1.5 text-start font-semibold">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-expanded={expanded}
              title={expanded ? t('designer.collapseClass') : t('designer.expandClass')}
              aria-label={expanded ? t('designer.collapseClass') : t('designer.expandClass')}
              onClick={() => setExpanded((v) => !v)}
              data-testid={ex.designerGroupToggle(standard.id)}
            >
              {expanded ? (
                <ChevronDown className="size-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-4" aria-hidden="true" />
              )}
            </Button>
            <span>{className}</span>
            {sections.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({sections.length})</span>
            )}
          </div>
        </th>
        {/* Per-date quick action — fills this date column for every section of this class. */}
        {dates.map((date, i) => {
          const holidayName = holidayByDate.get(date);
          return (
            <React.Fragment key={date}>
              <td className="border-s bg-muted/40 px-2 py-1.5 align-top">
                {expanded && !holidayName && sections.length > 0 && (
                  <Can I="update" a="Exam">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                      title={t('designer.applyAllForDate')}
                      onClick={() =>
                        onOpenTarget({
                          standardId: standard.id,
                          sections,
                          sectionId: null,
                          sectionLabel: '',
                          date,
                          applyAll: true,
                        })
                      }
                      data-testid={ex.designerDateAddAll(standard.id, date)}
                    >
                      <Users className="size-3" aria-hidden="true" />
                      {t('designer.applyAllForDate')}
                    </Button>
                  </Can>
                )}
              </td>
              {hasDateGap(dates, i) && <td key={`gap-${date}`} />}
            </React.Fragment>
          );
        })}
        <td />
      </tr>

      {expanded &&
        (sections.length === 0 ? (
          <tr className="border-t">
            <td colSpan={colSpan} className="px-3 py-2 text-xs text-muted-foreground">
              {t('designer.noSections')}
            </td>
          </tr>
        ) : (
          sections.map((section) => (
            <tr key={section.id} className="border-t">
              <th className="sticky start-0 z-10 min-w-[8rem] bg-card px-3 py-2 text-start align-top font-medium">
                {sectionLabel(section)}
              </th>
              {dates.map((date, i) => {
                const holidayName = holidayByDate.get(date);
                const papers = papersByCell.get(`${section.id}|${date}`) ?? [];
                return (
                  <React.Fragment key={date}>
                    <td className={cn('border-s p-1 align-top', holidayName && 'bg-muted/40')}>
                      <DesignerCellButton
                        papers={papers}
                        subjectName={subjectName}
                        isHoliday={!!holidayName}
                        onClick={() =>
                          onOpenTarget({
                            standardId: standard.id,
                            sections,
                            sectionId: section.id,
                            sectionLabel: sectionLabel(section),
                            date,
                            applyAll: false,
                          })
                        }
                        testId={ex.designerCell(section.id, date)}
                        addLabel={t('designer.addPaper')}
                        manageHint={t('designer.managePapers')}
                        addHint={t('designer.addPaperHint')}
                      />
                    </td>
                    {hasDateGap(dates, i) && <td key={`gap-${date}`} />}
                  </React.Fragment>
                );
              })}
              <td />
            </tr>
          ))
        ))}
    </tbody>
  );
}

function DesignerCellButton({
  papers,
  subjectName,
  isHoliday,
  onClick,
  testId,
  addLabel,
  manageHint,
  addHint,
}: {
  papers: ExamSchedule[];
  subjectName: (id: string) => string;
  isHoliday: boolean;
  onClick: () => void;
  testId: string;
  addLabel: string;
  manageHint: string;
  addHint: string;
}) {
  const hasPapers = papers.length > 0;
  return (
    <Can I="update" a="Exam" passThrough>
      {(allowed: boolean) => (
        <button
          type="button"
          disabled={!allowed}
          title={hasPapers ? manageHint : addHint}
          className={cn(
            'group block w-full min-h-[3rem] space-y-1 rounded-md p-1 text-start transition-colors',
            hasPapers
              ? 'hover:bg-accent/50'
              : 'border border-dashed border-border text-muted-foreground hover:border-primary hover:bg-accent/50 hover:text-foreground',
            isHoliday && 'opacity-80',
            'disabled:cursor-default disabled:opacity-70 disabled:hover:border-border disabled:hover:bg-transparent',
          )}
          onClick={onClick}
          data-testid={testId}
        >
          {hasPapers ? (
            papers.map((paper) => (
              <span
                key={paper.id}
                className="block rounded-md border border-primary/40 bg-card px-1.5 py-1 text-xs shadow-sm"
              >
                <span className="block font-semibold leading-tight">
                  {subjectName(paper.subjectId)}
                </span>
                {paper.startTime && paper.endTime && (
                  <span className="block text-muted-foreground tabular-nums">
                    {paper.startTime.slice(0, 5)}–{paper.endTime.slice(0, 5)}
                  </span>
                )}
                {paper.room && <span className="block text-muted-foreground">{paper.room}</span>}
              </span>
            ))
          ) : (
            <span className="flex items-center gap-1 text-xs">
              <Plus className="size-3" aria-hidden="true" /> {addLabel}
            </span>
          )}
        </button>
      )}
    </Can>
  );
}

// Designer-cell context passed to the unified PaperDialog. Standard/Section/Date
// are fixed by the cell; `sections` scopes apply-all; holiday info drives the warning.
interface PaperPreset {
  standardId: string;
  sectionId: string | null;
  sectionLabel: string;
  date: string;
  sections: Section[];
  isHoliday: boolean;
  holidayName: string | null;
}

// All editable paper fields + setters in one bundle so the PaperDialog body can
// delegate to presentational subcomponents and stay within the complexity budget.
type PaperForm = ReturnType<typeof usePaperForm>;

function usePaperForm(preset: PaperPreset | undefined, editing: ExamSchedule | null) {
  // No-preset add cascades Standard→Section→Subject; a preset fixes the standard.
  const [pickedStandardId, setPickedStandardId] = React.useState<string | null>(null);
  const [sectionId, setSectionId] = React.useState<string | null>(preset?.sectionId ?? null);
  const standardId = preset?.standardId ?? pickedStandardId;

  const [subjectId, setSubjectId] = React.useState(editing?.subjectId ?? '');
  const [component, setComponent] = React.useState<AssessmentComponent>(
    editing?.component ?? 'THEORY',
  );
  const [shift, setShift] = React.useState<Shift>('MORNING');
  const [startTime, setStartTime] = React.useState(
    editing ? (editing.startTime ?? '').slice(0, 5) : SHIFT_WINDOWS.MORNING.start,
  );
  const [endTime, setEndTime] = React.useState(
    editing ? (editing.endTime ?? '').slice(0, 5) : SHIFT_WINDOWS.MORNING.end,
  );
  const [maxMarks, setMaxMarks] = React.useState(editing ? String(editing.maxMarks) : '100');
  const [passMarks, setPassMarks] = React.useState(
    editing?.passMarks != null ? String(editing.passMarks) : '',
  );
  const [examDate, setExamDate] = React.useState(preset?.date ?? editing?.examDate ?? '');
  const [room, setRoom] = React.useState(editing?.room ?? '');
  const [invigilatorId, setInvigilatorId] = React.useState(
    editing?.invigilatorId ?? NO_INVIGILATOR,
  );
  // A preset with no section is the per-date header → apply-all locked on.
  const [applyAll, setApplyAll] = React.useState(!!preset && preset.sectionId == null);

  // Shift quick-pick seeds the time window but the times stay editable.
  const pickShift = (s: Shift) => {
    setShift(s);
    setStartTime(SHIFT_WINDOWS[s].start);
    setEndTime(SHIFT_WINDOWS[s].end);
  };
  const changeStandard = (s: string | null) => {
    setPickedStandardId(s);
    setSubjectId('');
  };
  // After stacking a paper in the designer, clear the per-paper fields only.
  const resetForNextPaper = () => {
    setSubjectId('');
    setRoom('');
    setInvigilatorId(NO_INVIGILATOR);
  };
  // Fields the update mutation accepts; the add path layers exam/section/subject on top.
  const schedulableFields = () => ({
    component,
    examDate: examDate || null,
    startTime: startTime || null,
    endTime: endTime || null,
    maxMarks: Number(maxMarks) || 100,
    passMarks: passMarks === '' ? null : Number(passMarks),
    room: room || null,
    invigilatorId: invigilatorId === NO_INVIGILATOR ? null : invigilatorId,
  });

  return {
    standardId,
    sectionId,
    setSectionId,
    changeStandard,
    subjectId,
    setSubjectId,
    component,
    setComponent,
    shift,
    pickShift,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    maxMarks,
    setMaxMarks,
    passMarks,
    setPassMarks,
    examDate,
    setExamDate,
    room,
    setRoom,
    invigilatorId,
    setInvigilatorId,
    applyAll,
    setApplyAll,
    resetForNextPaper,
    schedulableFields,
  };
}

// Subject: read-only text in edit (the update mutation can't change it), a
// class-scoped picker otherwise.
function PaperSubjectField({
  isEditing,
  editing,
  subjectName,
  subjects,
  standardId,
  subjectId,
  onSubjectChange,
}: {
  isEditing: boolean;
  editing: ExamSchedule | null;
  subjectName: (id: string) => string;
  subjects: Subject[];
  standardId: string | null;
  subjectId: string;
  onSubjectChange: (id: string) => void;
}) {
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  if (isEditing && editing) {
    return (
      <Field>
        <FieldLabel>{t('datesheet.subject')}</FieldLabel>
        <p className="text-sm font-medium">{subjectName(editing.subjectId)}</p>
      </Field>
    );
  }
  return (
    <Field>
      <FieldLabel>{t('datesheet.subject')}</FieldLabel>
      <Select value={subjectId || undefined} onValueChange={onSubjectChange}>
        <SelectTrigger
          data-testid={ex.designerSubjectSelect}
          aria-label={t('datesheet.subject')}
          disabled={!standardId}
        >
          <SelectValue placeholder={t('designer.selectSubject')} />
        </SelectTrigger>
        <SelectContent>
          {subjects.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {resolveI18n(s.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

// Component, optional Date, Shift quick-pick, times, marks, room, invigilator —
// shared verbatim by every entry point. Reads/writes through the PaperForm bundle.
function PaperDetailFields({ form, showDate }: { form: PaperForm; showDate: boolean }) {
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const { staff } = useStaff();
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>{t('datesheet.component')}</FieldLabel>
          <Select
            value={form.component}
            onValueChange={(v) => form.setComponent(v as AssessmentComponent)}
          >
            <SelectTrigger
              data-testid={ex.scheduleComponentSelect}
              aria-label={t('datesheet.component')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSESSMENT_COMPONENTS.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`components.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {/* Date is fixed by the cell when preset; editable otherwise. */}
        {showDate && (
          <Field>
            <FieldLabel htmlFor="paper-date">{t('datesheet.date')}</FieldLabel>
            <Input
              id="paper-date"
              type="date"
              value={form.examDate}
              onChange={(e) => form.setExamDate(e.target.value)}
              data-testid={ex.scheduleDateInput}
            />
          </Field>
        )}
      </div>

      <Field>
        <FieldLabel>{t('designer.shift')}</FieldLabel>
        <Select value={form.shift} onValueChange={(v) => form.pickShift(v as Shift)}>
          <SelectTrigger data-testid={ex.designerShiftSelect} aria-label={t('designer.shift')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHIFTS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`designer.shifts.${s}`)} ({SHIFT_WINDOWS[s].start}–{SHIFT_WINDOWS[s].end})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="paper-start">{t('datesheet.startTime')}</FieldLabel>
          <Input
            id="paper-start"
            type="time"
            value={form.startTime}
            onChange={(e) => form.setStartTime(e.target.value)}
            data-testid={ex.designerStartInput}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="paper-end">{t('datesheet.endTime')}</FieldLabel>
          <Input
            id="paper-end"
            type="time"
            value={form.endTime}
            onChange={(e) => form.setEndTime(e.target.value)}
            data-testid={ex.designerEndInput}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="paper-max">{t('datesheet.maxMarks')}</FieldLabel>
          <Input
            id="paper-max"
            type="number"
            min={1}
            value={form.maxMarks}
            onChange={(e) => form.setMaxMarks(e.target.value)}
            data-testid={ex.scheduleMaxMarksInput}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="paper-pass">{t('datesheet.passMarks')}</FieldLabel>
          <Input
            id="paper-pass"
            type="number"
            min={0}
            value={form.passMarks}
            onChange={(e) => form.setPassMarks(e.target.value)}
            data-testid={ex.schedulePassMarksInput}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="paper-room">{t('datesheet.room')}</FieldLabel>
        <Input
          id="paper-room"
          value={form.room}
          placeholder={t('designer.roomPlaceholder')}
          onChange={(e) => form.setRoom(e.target.value)}
          data-testid={ex.designerRoomInput}
        />
      </Field>

      <Field>
        <FieldLabel>{t('datesheet.invigilator')}</FieldLabel>
        <Select value={form.invigilatorId} onValueChange={form.setInvigilatorId}>
          <SelectTrigger
            data-testid={ex.designerInvigilatorSelect}
            aria-label={t('datesheet.invigilator')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_INVIGILATOR}>{t('datesheet.noInvigilator')}</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.membershipId} value={s.membershipId}>
                {`${resolveI18n(s.firstName)} ${resolveI18n(s.lastName ?? {})}`.trim()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

// One dialog for every paper-entry path:
//  • List "Add subject" → mode=add, no preset (renders Standard/Section/Date pickers).
//  • List row Edit       → mode=edit, editing=row (Subject + Section read-only; the
//                          update mutation can't move a paper across subject/section).
//  • Designer cell       → mode=add (or edit if the cell holds a paper), preset=cell
//                          context (fixed Standard/Section/Date + apply-all checkbox).
function PaperDialog({
  examId,
  academicYearId,
  mode,
  preset,
  editing,
  subjectName,
  existingPapers = [],
  open,
  onOpenChange,
}: {
  examId: string;
  academicYearId: string;
  mode: 'add' | 'edit';
  preset?: PaperPreset;
  editing?: ExamSchedule | null;
  subjectName: (id: string) => string;
  existingPapers?: ExamSchedule[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('examinations');
  const { format } = useFormatDate();
  const { addSchedule, loading: adding } = useAddExamSchedule();
  const { updateSchedule, loading: updating } = useUpdateExamSchedule();

  const isEditing = mode === 'edit' && !!editing;
  const loading = isEditing ? updating : adding;

  const form = usePaperForm(preset, editing ?? null);
  const { subjects } = useSubjectsByStandard(form.standardId);

  // Apply-all only shows for a designer cell in add mode; locked on when the entry
  // point is the per-date "all sections" header (preset has no section).
  const showApplyAll = !!preset && mode === 'add';
  const lockApplyAll = preset?.sectionId == null;

  const addPaper = async () => {
    // Apply-all loops the class's sections; otherwise the single chosen/preset section.
    const targetSections = form.applyAll
      ? (preset?.sections ?? []).map((s) => s.id)
      : preset?.sectionId
        ? [preset.sectionId]
        : form.sectionId
          ? [form.sectionId]
          : [];
    for (const secId of targetSections) {
      await addSchedule({
        examId,
        sectionId: secId,
        subjectId: form.subjectId,
        ...form.schedulableFields(),
      });
    }
    if (form.applyAll) {
      toast.success(t('designer.applyAllDone', { count: targetSections.length }));
      onOpenChange(false);
    } else if (preset) {
      // Designer cell: keep open so the teacher can stack same-day papers; reset.
      toast.success(t('designer.saved'));
      form.resetForNextPaper();
    } else {
      toast.success(t('datesheet.added'));
      onOpenChange(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.subjectId) {
      toast.error(t('designer.subjectRequired'));
      return;
    }
    if (mode === 'add' && !preset && !form.sectionId) return;
    try {
      if (isEditing && editing) {
        await updateSchedule(editing.id, form.schedulableFields());
        toast.success(t('datesheet.updated'));
        onOpenChange(false);
      } else {
        await addPaper();
      }
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };

  const title = isEditing ? t('datesheet.editTitle') : t('designer.dialogTitle');
  const dateLabel = preset ? format(new Date(`${preset.date}T00:00:00`), 'dd/MM/yyyy') : '';
  const subtitle = preset
    ? lockApplyAll
      ? dateLabel
      : t('designer.dialogSubtitle', { section: preset.sectionLabel, date: dateLabel })
    : null;
  const submitLabel = isEditing
    ? loading
      ? t('saving')
      : t('save')
    : loading
      ? t('saving')
      : t('designer.addAnother');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[85vh] overflow-y-auto"
        data-testid={ex.designerDialog}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </DialogHeader>

        <div className="space-y-4">
          {preset?.isHoliday && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {t('designer.holidayWarning', { name: preset.holidayName ?? '' })}
            </p>
          )}

          {/* Existing papers for this exact (section, date) — only on a scoped cell. */}
          {preset && !lockApplyAll && existingPapers.length > 0 && (
            <ExistingPapers papers={existingPapers} subjectName={subjectName} />
          )}

          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('designer.newPaper')}</p>

            {/* Context block: preset → header line (no pickers); edit → read-only subject;
                no-preset add → Standard/Section pickers. */}
            {!preset && !isEditing && (
              <PaperStandardSection
                academicYearId={academicYearId}
                sectionId={form.sectionId}
                onSectionChange={form.setSectionId}
                onStandardChange={form.changeStandard}
              />
            )}

            <PaperSubjectField
              isEditing={isEditing}
              editing={editing ?? null}
              subjectName={subjectName}
              subjects={subjects}
              standardId={form.standardId}
              subjectId={form.subjectId}
              onSubjectChange={form.setSubjectId}
            />

            <PaperDetailFields form={form} showDate={!preset} />

            {showApplyAll && (
              <div className="flex items-start gap-2 rounded-md bg-accent/40 p-2 text-sm">
                <Checkbox
                  id="paper-apply-all"
                  checked={form.applyAll}
                  // The per-date header is inherently apply-all; keep it locked on there.
                  disabled={lockApplyAll}
                  onCheckedChange={(v) => form.setApplyAll(v === true)}
                  data-testid={ex.designerApplyAll}
                />
                <FieldLabel htmlFor="paper-apply-all" className="font-normal">
                  <span className="block font-medium leading-tight">{t('designer.applyAll')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('designer.applyAllHint', { date: dateLabel })}
                  </span>
                </FieldLabel>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Can I="update" a="Exam">
            <Button
              className="gap-1.5"
              disabled={
                loading || !form.subjectId || (mode === 'add' && !preset && !form.sectionId)
              }
              onClick={handleSubmit}
              data-testid={isEditing ? ex.scheduleSubmitBtn : ex.designerAddPaperBtn}
            >
              {!isEditing && <Plus className="size-3.5" />}
              {submitLabel}
            </Button>
          </Can>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Read-only list of papers already scheduled for a designer cell (section, date),
// each with a remove action. Extracted to keep PaperDialog within the complexity budget.
function ExistingPapers({
  papers,
  subjectName,
}: {
  papers: ExamSchedule[];
  subjectName: (id: string) => string;
}) {
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const { staff } = useStaff();
  const { removeSchedule, loading: removing } = useRemoveExamSchedule();

  const invigilatorName = (id: string | null) => {
    if (!id) return null;
    const s = staff.find((m) => m.membershipId === id);
    return s ? `${resolveI18n(s.firstName)} ${resolveI18n(s.lastName ?? {})}`.trim() : null;
  };

  const handleRemove = async (id: string) => {
    try {
      await removeSchedule(id);
      toast.success(t('designer.removed'));
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{t('designer.existingPapers')}</p>
      {papers.map((paper) => {
        const inv = invigilatorName(paper.invigilatorId);
        return (
          <div
            key={paper.id}
            className="flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
            data-testid={ex.designerPaperRow(paper.id)}
          >
            <span>
              <span className="font-semibold">{subjectName(paper.subjectId)}</span>
              {paper.startTime && paper.endTime && (
                <span className="ms-2 text-muted-foreground tabular-nums">
                  {paper.startTime.slice(0, 5)}–{paper.endTime.slice(0, 5)}
                </span>
              )}
              {(paper.room || inv) && (
                <span className="block text-muted-foreground">
                  {[paper.room, inv].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
            <Can I="update" a="Exam">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-destructive"
                title={t('designer.removePaper')}
                aria-label={t('designer.removePaper')}
                disabled={removing}
                onClick={() => handleRemove(paper.id)}
                data-testid={ex.designerPaperRemoveBtn(paper.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </Can>
          </div>
        );
      })}
    </div>
  );
}

// Cascading Standard → Section picker for the no-preset add path. Subjects are
// class-specific, so the parent re-fetches them when the standard changes.
function PaperStandardSection({
  academicYearId,
  sectionId,
  onSectionChange,
  onStandardChange,
}: {
  academicYearId: string;
  sectionId: string | null;
  onSectionChange: (id: string | null) => void;
  onStandardChange: (id: string | null) => void;
}) {
  return (
    <StandardSectionSelect
      academicYearId={academicYearId}
      sectionId={sectionId}
      onSectionChange={onSectionChange}
      onStandardChange={onStandardChange}
      standardTestId={ex.scheduleStandardSelect}
      sectionTestId={ex.scheduleSectionSelect}
    />
  );
}

interface MarkEdit {
  studentId: string;
  obtainedMarks: string;
  isAbsent: boolean;
}

function MarksDialog({
  examId,
  examScheduleId,
  open,
  onOpenChange,
}: {
  examId: string;
  examScheduleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('examinations');
  const { sheet, loading } = useExamMarksSheet(examScheduleId);
  const { enterMarks, loading: saving } = useEnterExamMarks();
  const [edits, setEdits] = React.useState<Record<string, MarkEdit>>({});

  React.useEffect(() => {
    if (!sheet) return;
    const init: Record<string, MarkEdit> = {};
    for (const row of sheet.rows) {
      init[row.studentId] = {
        studentId: row.studentId,
        obtainedMarks: row.obtainedMarks != null ? String(row.obtainedMarks) : '',
        isAbsent: row.isAbsent,
      };
    }
    setEdits(init);
  }, [sheet]);

  const update = (studentId: string, patch: Partial<MarkEdit>) =>
    setEdits((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }));

  const handleSave = async () => {
    const marks = Object.values(edits).map((e) => ({
      examScheduleId,
      studentId: e.studentId,
      obtainedMarks: e.isAbsent || e.obtainedMarks === '' ? null : Number(e.obtainedMarks),
      isAbsent: e.isAbsent,
    }));
    try {
      await enterMarks(examId, marks);
      toast.success(t('marks.saved'));
      onOpenChange(false);
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid={ex.marksPage}>
        <DialogHeader>
          <DialogTitle>
            {t('marks.title')}
            {sheet
              ? ` · ${t(`components.${sheet.schedule.component}`)} · ${t('datesheet.maxMarks')} ${sheet.schedule.maxMarks}`
              : ''}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="space-y-2 rounded-md border p-2" data-testid={ex.marksSkeleton}>
            {Array.from({ length: 6 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border" data-testid={ex.marksGrid}>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>{t('marks.rollNumber')}</TableHead>
                  <TableHead>{t('marks.student')}</TableHead>
                  <TableHead>{t('marks.obtained')}</TableHead>
                  <TableHead>{t('marks.absent')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sheet?.rows ?? []).map((row) => {
                  const e = edits[row.studentId];
                  return (
                    <TableRow key={row.studentId}>
                      <TableCell className="tabular-nums">{row.rollNumber ?? '—'}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={sheet?.schedule.maxMarks}
                          className="h-8 w-24"
                          value={e?.isAbsent ? '' : (e?.obtainedMarks ?? '')}
                          disabled={e?.isAbsent}
                          onChange={(ev) =>
                            update(row.studentId, { obtainedMarks: ev.target.value })
                          }
                          data-testid={ex.marksInput(row.studentId)}
                        />
                      </TableCell>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={e?.isAbsent ?? false}
                          onChange={(ev) => update(row.studentId, { isAbsent: ev.target.checked })}
                          data-testid={ex.marksAbsentToggle(row.studentId)}
                          aria-label={t('marks.absent')}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button disabled={saving} onClick={handleSave} data-testid={ex.marksSaveBtn}>
            {saving ? t('saving') : t('marks.saveAll')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" data-testid={ex.detailSkeleton}>
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-9 w-64" />
        </div>
      </div>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function DatesheetSkeleton() {
  return (
    <div className="space-y-2 rounded-md border p-2" data-testid={ex.datesheetSkeleton}>
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 5 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
        <Skeleton key={i} className="h-11 w-full" />
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
