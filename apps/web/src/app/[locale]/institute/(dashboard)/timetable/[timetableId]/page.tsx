'use client';

import { useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
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
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ArrowLeft, CalendarClock, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { mapError, TimeInput } from '../timetable-shared';
import {
  type DaySession,
  type GridEntry,
  type PeriodKind,
  type TimetablePeriod,
  type TimetableStatus,
  useAddTimetablePeriod,
  useAssignTimetableEntry,
  useClearTimetableEntry,
  useRemoveTimetablePeriod,
  useSectionTimetable,
  useTimetable,
  useUpdateTimetableStatus,
  type Weekday,
} from '../use-timetable';
import { TimetableLookupsProvider, useTimetableLookups } from '../use-timetable-lookups';

const { instituteTimetable } = testIds;

export default function TimetableEditorPage() {
  const params = useParams();
  const locale = params.locale as string;
  const timetableId = params.timetableId as string;
  const t = useTranslations('timetable');
  const resolveI18n = useI18nField();
  const { timetable, loading } = useTimetable(timetableId);

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!timetable) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClock />
          </EmptyMedia>
          <EmptyTitle>{t('noTimetables')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <TimetableLookupsProvider academicYearId={timetable.academicYearId}>
      <div className="space-y-6" data-testid={instituteTimetable.editorPage}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href={`/${locale}/institute/timetable`}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              data-testid={instituteTimetable.editorBackLink}
            >
              <ArrowLeft className="size-3.5" /> {t('editor.back')}
            </Link>
            <h1
              className="text-2xl font-semibold tracking-tight"
              data-testid={instituteTimetable.editorTitle}
            >
              {resolveI18n(timetable.name)}
            </h1>
          </div>
          <StatusControls id={timetable.id} status={timetable.status} t={t} />
        </div>

        <PeriodAndGridEditor timetableId={timetableId} />
      </div>
    </TimetableLookupsProvider>
  );
}

function StatusControls({
  id,
  status,
  t,
}: {
  id: string;
  status: TimetableStatus;
  t: ReturnType<typeof useTranslations<'timetable'>>;
}) {
  const { updateStatus, loading } = useUpdateTimetableStatus();
  const run = async (next: TimetableStatus, msg: string) => {
    try {
      await updateStatus(id, next);
      toast.success(msg);
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };
  return (
    <Can I="update" a="Timetable">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{t(`statuses.${status}`)}</Badge>
        {status !== 'ACTIVE' && status !== 'ARCHIVED' && (
          <Button
            size="sm"
            disabled={loading}
            onClick={() => run('ACTIVE', t('editor.activated'))}
            data-testid={instituteTimetable.activateBtn}
          >
            {t('editor.activate')}
          </Button>
        )}
        {status === 'ACTIVE' && (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => run('INACTIVE', t('editor.deactivated'))}
            data-testid={instituteTimetable.deactivateBtn}
          >
            {t('editor.deactivate')}
          </Button>
        )}
        {status !== 'ARCHIVED' && (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => run('ARCHIVED', t('editor.archived'))}
            data-testid={instituteTimetable.archiveBtn}
          >
            {t('editor.archive')}
          </Button>
        )}
      </div>
    </Can>
  );
}

function PeriodAndGridEditor({ timetableId }: { timetableId: string }) {
  const t = useTranslations('timetable');
  const { timetable } = useTimetable(timetableId);
  const lookups = useTimetableLookups();

  const [activeSectionId, setActiveSectionId] = React.useState<string | null>(null);
  const sections = timetable?.sections ?? [];

  React.useEffect(() => {
    if (!activeSectionId && sections.length > 0) {
      setActiveSectionId(sections[0].sectionId);
    }
  }, [sections, activeSectionId]);

  if (!timetable) return null;

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('editor.noSectionsCovered')}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={activeSectionId ?? undefined} onValueChange={setActiveSectionId}>
          <TabsList>
            {sections.map((s) => (
              <TabsTrigger
                key={s.sectionId}
                value={s.sectionId}
                data-testid={instituteTimetable.sectionTab(s.sectionId)}
              >
                {lookups.sectionLabel(s.sectionId)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Can I="update" a="Timetable">
          <PeriodActions
            timetableId={timetableId}
            defaultDuration={timetable.defaultPeriodDurationMins}
          />
        </Can>
      </div>

      {activeSectionId && (
        <SectionGrid
          timetableId={timetableId}
          sectionId={activeSectionId}
          periods={timetable.periods}
          workingDays={timetable.workingDays}
        />
      )}
    </div>
  );
}

function PeriodActions({
  timetableId,
  defaultDuration,
}: {
  timetableId: string;
  defaultDuration: number;
}) {
  const t = useTranslations('timetable');
  const [dialogKind, setDialogKind] = React.useState<PeriodKind | null>(null);
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setDialogKind('PERIOD')}
        data-testid={instituteTimetable.addPeriodBtn}
      >
        <Plus className="size-3.5" /> {t('editor.addPeriod')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setDialogKind('BREAK')}
        data-testid={instituteTimetable.addBreakBtn}
      >
        <Plus className="size-3.5" /> {t('editor.addBreak')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setDialogKind('EXTRA')}
        data-testid={instituteTimetable.addExtraBtn}
      >
        <Plus className="size-3.5" /> {t('editor.addExtra')}
      </Button>
      {dialogKind && (
        <AddPeriodDialog
          timetableId={timetableId}
          kind={dialogKind}
          defaultDuration={defaultDuration}
          open={!!dialogKind}
          onOpenChange={(open) => !open && setDialogKind(null)}
        />
      )}
    </div>
  );
}

function AddPeriodDialog({
  timetableId,
  kind,
  defaultDuration,
  open,
  onOpenChange,
}: {
  timetableId: string;
  kind: PeriodKind;
  defaultDuration: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('timetable');
  const { addPeriod, loading } = useAddTimetablePeriod();
  const [label, setLabel] = React.useState('');
  const [duration, setDuration] = React.useState(defaultDuration);
  const [startTime, setStartTime] = React.useState('07:15');
  const [session, setSession] = React.useState<DaySession>('MORNING');

  const title =
    kind === 'BREAK'
      ? t('period.dialogTitleBreak')
      : kind === 'EXTRA'
        ? t('period.dialogTitleExtra')
        : t('period.dialogTitlePeriod');

  const handleSubmit = async () => {
    try {
      await addPeriod({
        timetableId,
        kind,
        label: label || null,
        durationMins: duration,
        startTime: kind === 'EXTRA' ? startTime : null,
        session: kind === 'EXTRA' ? session : null,
      });
      toast.success(t('editor.periodAdded'));
      onOpenChange(false);
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid={instituteTimetable.periodDialog}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field>
            <FieldLabel>{t('period.label')}</FieldLabel>
            <Input
              value={label}
              placeholder={t('period.labelPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
              data-testid={instituteTimetable.periodLabelInput}
            />
          </Field>
          <Field>
            <FieldLabel>{t('period.duration')}</FieldLabel>
            <Input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              data-testid={instituteTimetable.periodDurationInput}
            />
          </Field>
          {kind === 'EXTRA' && (
            <>
              <TimeInput
                label={t('period.startTime')}
                value={startTime}
                onChange={setStartTime}
                testId={instituteTimetable.periodStartInput}
              />
              <Field>
                <FieldLabel>{t('period.session')}</FieldLabel>
                <Select value={session} onValueChange={(v) => setSession(v as DaySession)}>
                  <SelectTrigger data-testid={instituteTimetable.periodSessionSelect}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['MORNING', 'EVENING'] as DaySession[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`sessions.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid={instituteTimetable.periodCancelBtn}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={loading}
            onClick={handleSubmit}
            data-testid={instituteTimetable.periodSubmitBtn}
          >
            {loading ? t('period.adding') : t('period.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CellContext {
  period: TimetablePeriod;
  day: Weekday;
  entries: GridEntry[];
}

function SectionGrid({
  timetableId,
  sectionId,
  periods,
  workingDays,
}: {
  timetableId: string;
  sectionId: string;
  periods: TimetablePeriod[];
  workingDays: Weekday[];
}) {
  const t = useTranslations('timetable');
  const lookups = useTimetableLookups();
  const { grid } = useSectionTimetable(sectionId, timetableId);
  const { removePeriod } = useRemoveTimetablePeriod();
  const [cell, setCell] = React.useState<CellContext | null>(null);

  const sortedPeriods = React.useMemo(
    () => [...periods].sort((a, b) => a.sequence - b.sequence),
    [periods],
  );

  const entriesFor = (periodId: string, day: Weekday): GridEntry[] =>
    (grid?.entries ?? []).filter((e) => e.periodId === periodId && e.dayOfWeek === day);

  if (sortedPeriods.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('editor.noPeriods')}</p>;
  }

  const handleRemovePeriod = async (periodId: string) => {
    if (!window.confirm(t('editor.removePeriodConfirm'))) return;
    try {
      await removePeriod(timetableId, periodId);
      toast.success(t('editor.periodRemoved'));
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };

  return (
    <>
      <div className="overflow-x-auto rounded-md border" data-testid={instituteTimetable.grid}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="p-2 text-start font-medium">{t('editor.period')}</th>
              {workingDays.map((day) => (
                <th key={day} className="p-2 text-start font-medium">
                  {t(`weekdaysShort.${day}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedPeriods.map((period) => (
              <tr key={period.id} className="border-t">
                <th className="p-2 text-start align-top">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-medium">{period.label}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {period.startTime.slice(0, 5)}–{period.endTime.slice(0, 5)}
                      </span>
                    </div>
                    <Can I="update" a="Timetable">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-6 p-0 text-muted-foreground hover:text-destructive"
                        title={t('editor.removePeriod')}
                        aria-label={t('editor.removePeriod')}
                        onClick={() => handleRemovePeriod(period.id)}
                        data-testid={instituteTimetable.removePeriodBtn(period.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </Can>
                  </div>
                </th>
                {workingDays.map((day) => {
                  if (period.kind === 'BREAK') {
                    return (
                      <td
                        key={day}
                        className="p-2 bg-muted/30 text-center text-xs text-muted-foreground"
                        data-testid={instituteTimetable.gridCell(period.id, day)}
                      >
                        {t('editor.breakCell')}
                      </td>
                    );
                  }
                  const cellEntries = entriesFor(period.id, day);
                  return (
                    <td key={day} className="p-1 align-top">
                      <button
                        type="button"
                        className="w-full min-h-[3rem] rounded border border-dashed border-border p-1.5 text-start hover:border-primary hover:bg-accent/50 transition-colors"
                        onClick={() => setCell({ period, day, entries: cellEntries })}
                        data-testid={instituteTimetable.gridCell(period.id, day)}
                      >
                        {cellEntries.length === 0 ? (
                          <span className="text-xs text-muted-foreground">+</span>
                        ) : (
                          <div className="space-y-1">
                            {cellEntries.map((entry) => (
                              <div key={entry.id} className="text-xs">
                                {entry.splitLabel && (
                                  <span className="font-medium">{entry.splitLabel}: </span>
                                )}
                                <span className="font-medium">
                                  {lookups.subjectLabel(entry.subjectId) || t('assign.unassigned')}
                                </span>
                                {entry.teacherId && (
                                  <span className="block text-muted-foreground">
                                    {lookups.teacherLabel(entry.teacherId)}
                                  </span>
                                )}
                                {entry.room && (
                                  <span className="block text-muted-foreground">{entry.room}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cell && (
        <AssignDialog
          timetableId={timetableId}
          sectionId={sectionId}
          period={cell.period}
          initialDay={cell.day}
          existing={cell.entries}
          workingDays={workingDays}
          open={!!cell}
          onOpenChange={(open) => !open && setCell(null)}
        />
      )}
    </>
  );
}

interface SplitRow {
  splitIndex: number;
  splitLabel: string;
  subjectId: string;
  teacherId: string;
  room: string;
}

function AssignDialog({
  timetableId,
  sectionId,
  period,
  initialDay,
  existing,
  workingDays,
  open,
  onOpenChange,
}: {
  timetableId: string;
  sectionId: string;
  period: TimetablePeriod;
  initialDay: Weekday;
  existing: GridEntry[];
  workingDays: Weekday[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('timetable');
  const lookups = useTimetableLookups();
  const { assignEntry, loading } = useAssignTimetableEntry();
  const { clearEntry } = useClearTimetableEntry();

  const [days, setDays] = React.useState<Weekday[]>([initialDay]);
  const [splits, setSplits] = React.useState<SplitRow[]>(() =>
    existing.length > 0
      ? existing.map((e) => ({
          splitIndex: e.splitIndex,
          splitLabel: e.splitLabel ?? '',
          subjectId: e.subjectId ?? '',
          teacherId: e.teacherId ?? '',
          room: e.room ?? '',
        }))
      : [{ splitIndex: 0, splitLabel: '', subjectId: '', teacherId: '', room: '' }],
  );

  const subjectOptions = lookups.subjectGroups.flatMap((g) => g.options);

  const toggleDay = (day: Weekday) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));

  const updateSplit = (i: number, patch: Partial<SplitRow>) =>
    setSplits((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const addSplit = () =>
    setSplits((prev) => [
      ...prev,
      { splitIndex: prev.length, splitLabel: '', subjectId: '', teacherId: '', room: '' },
    ]);

  const removeSplit = (i: number) => setSplits((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (days.length === 0) return;
    try {
      await assignEntry({
        timetableId,
        sectionId,
        periodId: period.id,
        days: days.map((dayOfWeek) => ({ dayOfWeek })),
        splits: splits.map((s, idx) => ({
          splitIndex: idx,
          splitLabel: s.splitLabel || null,
          subjectId: s.subjectId || null,
          teacherId: s.teacherId || null,
          room: s.room || null,
        })),
      });
      toast.success(t('assign.assigned'));
      onOpenChange(false);
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };

  const handleClear = async () => {
    try {
      await Promise.all(
        existing.map((e) =>
          clearEntry({
            timetableId,
            sectionId,
            periodId: period.id,
            dayOfWeek: e.dayOfWeek,
            splitIndex: e.splitIndex,
          }),
        ),
      );
      toast.success(t('assign.cleared'));
      onOpenChange(false);
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid={instituteTimetable.assignDialog}
      >
        <DialogHeader>
          <DialogTitle>
            {t('assign.dialogTitle')} · {period.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel>{t('assign.days')}</FieldLabel>
            <p className="text-xs text-muted-foreground">{t('assign.daysHint')}</p>
            <div className="flex flex-wrap gap-2">
              {workingDays.map((day) => (
                <Button
                  key={day}
                  type="button"
                  size="sm"
                  variant={days.includes(day) ? 'default' : 'outline'}
                  onClick={() => toggleDay(day)}
                  data-testid={instituteTimetable.assignDay(day)}
                >
                  {t(`weekdaysShort.${day}`)}
                </Button>
              ))}
            </div>
          </Field>

          <Separator />

          <div className="flex items-center justify-between">
            <FieldLabel>{t('assign.splits')}</FieldLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={addSplit}
              data-testid={instituteTimetable.assignAddSplitBtn}
            >
              <Plus className="size-3" /> {t('assign.addSplit')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('assign.splitsHint')}</p>

          <div className="space-y-3">
            {splits.map((split, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional split identity.
              <div key={i} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Input
                    value={split.splitLabel}
                    placeholder={t('assign.splitLabelPlaceholder')}
                    onChange={(e) => updateSplit(i, { splitLabel: e.target.value })}
                    className="h-8 max-w-[10rem]"
                    data-testid={instituteTimetable.assignSplitLabelInput(i)}
                  />
                  {splits.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeSplit(i)}
                      title={t('assign.removeSplit')}
                      aria-label={t('assign.removeSplit')}
                      data-testid={instituteTimetable.assignRemoveSplitBtn(i)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Field>
                    <FieldLabel>{t('assign.subject')}</FieldLabel>
                    <Select
                      value={split.subjectId || undefined}
                      onValueChange={(v) => updateSplit(i, { subjectId: v })}
                    >
                      <SelectTrigger data-testid={instituteTimetable.assignSubjectSelect(i)}>
                        <SelectValue placeholder={t('assign.selectSubject')} />
                      </SelectTrigger>
                      <SelectContent>
                        {subjectOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>{t('assign.teacher')}</FieldLabel>
                    <Select
                      value={split.teacherId || undefined}
                      onValueChange={(v) => updateSplit(i, { teacherId: v })}
                    >
                      <SelectTrigger data-testid={instituteTimetable.assignTeacherSelect(i)}>
                        <SelectValue placeholder={t('assign.selectTeacher')} />
                      </SelectTrigger>
                      <SelectContent>
                        {lookups.teacherOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>{t('assign.room')}</FieldLabel>
                    <Input
                      value={split.room}
                      placeholder={t('assign.roomPlaceholder')}
                      onChange={(e) => updateSplit(i, { room: e.target.value })}
                      data-testid={instituteTimetable.assignRoomInput(i)}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {existing.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive me-auto"
              onClick={handleClear}
              data-testid={instituteTimetable.assignClearBtn}
            >
              {t('assign.clear')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid={instituteTimetable.assignCancelBtn}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={loading || days.length === 0}
            onClick={handleSave}
            data-testid={instituteTimetable.assignSubmitBtn}
          >
            {loading ? t('assign.saving') : t('assign.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
