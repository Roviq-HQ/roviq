'use client';

import { Link } from '@roviq/i18n';
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
  Textarea,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { StandardSectionSelect } from '@web/components/pickers/standard-section-select';
import { CalendarClock, ClipboardCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { AcademicYearSelector, useSelectedAcademicYear } from '../../academic-years/year-selector';
import { mapError } from '../timetable-shared';
import {
  type DayScheduleSlot,
  type TimetableOverrideType,
  useClearTimetableDayOverride,
  useCreateTimetableDayOverride,
  useSectionTimetable,
  useTimetableDayOverrides,
  useTimetableDaySchedule,
} from '../use-timetable';
import { TimetableLookupsProvider, useTimetableLookups } from '../use-timetable-lookups';

const { instituteTimetable } = testIds;
const OVERRIDE_TYPES: TimetableOverrideType[] = [
  'SUBSTITUTION',
  'CANCELLATION',
  'ROOM_CHANGE',
  'SUBJECT_CHANGE',
  'EXTRA',
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Deep-link to the attendance page pre-filled for this period. The attendance
 * `period` is an integer; generated timetable periods are labelled "1".."N", so
 * a numeric label maps straight through. Non-numeric labels (extra/named blocks)
 * fall back to daily (no period param).
 */
function attendanceHref(
  date: string,
  standardId: string | null,
  sectionId: string,
  periodLabel: string,
): string {
  const params = new URLSearchParams({ date, section: sectionId });
  if (standardId) params.set('standard', standardId);
  const periodNum = Number.parseInt(periodLabel, 10);
  if (String(periodNum) === periodLabel.trim() && periodNum > 0) {
    params.set('period', String(periodNum));
  }
  return `/institute/attendance?${params.toString()}`;
}

export default function DaySchedulePage() {
  const t = useTranslations('timetable');
  const { yearId } = useSelectedAcademicYear();

  return (
    <Can I="read" a="Timetable" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <TimetableLookupsProvider academicYearId={yearId}>
            <DayScheduleInner academicYearId={yearId} />
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

function DayScheduleInner({ academicYearId }: { academicYearId: string | null }) {
  const t = useTranslations('timetable');
  const lookups = useTimetableLookups();
  const [date, setDate] = React.useState<string>(todayIso());
  const [standardId, setStandardId] = React.useState<string | null>(null);
  const [sectionId, setSectionId] = React.useState<string | null>(null);

  const { schedule, loading } = useTimetableDaySchedule(date, sectionId);
  // Resolve the timetable that owns this section (for override mutations).
  const { grid } = useSectionTimetable(sectionId);
  const timetableId = grid?.timetableId ?? null;

  const [overrideSlot, setOverrideSlot] = React.useState<DayScheduleSlot | null>(null);

  return (
    <div className="space-y-6" data-testid={instituteTimetable.dayPage}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1
          className="text-2xl font-semibold tracking-tight"
          data-testid={instituteTimetable.dayTitle}
        >
          {t('day.title')}
        </h1>
        <AcademicYearSelector />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-44">
          <FieldLabel>{t('day.date')}</FieldLabel>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label={t('day.date')}
            data-testid={instituteTimetable.dayDateInput}
          />
        </Field>
        <StandardSectionSelect
          academicYearId={academicYearId}
          sectionId={sectionId}
          onSectionChange={setSectionId}
          onStandardChange={setStandardId}
          standardTestId={instituteTimetable.dayStandardSelect}
          sectionTestId={instituteTimetable.daySectionSelect}
        />
      </div>

      {!sectionId ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock />
            </EmptyMedia>
            <EmptyTitle>{t('day.pickSection')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : loading ? (
        <div className="h-48 flex items-center justify-center">
          <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : !schedule || schedule.slots.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('day.noSchedule')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-2 rounded-md border" data-testid={instituteTimetable.daySchedule}>
          {schedule.slots.map((slot) => (
            <div
              key={`${slot.periodId}-${slot.splitIndex}`}
              className="flex flex-wrap items-center justify-between gap-2 border-b p-3 last:border-b-0"
              data-testid={instituteTimetable.daySlot(slot.periodId)}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{slot.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}
                  </span>
                  {slot.isOverride && slot.overrideType && (
                    <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-0">
                      {t(`overrideTypes.${slot.overrideType}`)}
                    </Badge>
                  )}
                </div>
                <div className="text-sm">
                  {lookups.subjectLabel(slot.subjectId) || t('assign.unassigned')}
                  {slot.teacherId && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {lookups.teacherLabel(slot.teacherId)}
                    </span>
                  )}
                  {slot.room && <span className="text-muted-foreground"> · {slot.room}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {slot.kind !== 'BREAK' && sectionId && (
                  <Can I="create" a="Attendance">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      asChild
                      data-testid={instituteTimetable.dayTakeAttendanceLink(slot.periodId)}
                    >
                      <Link
                        href={attendanceHref(date, standardId, sectionId, slot.label)}
                        title={t('day.takeAttendance')}
                      >
                        <ClipboardCheck className="size-4" /> {t('day.takeAttendance')}
                      </Link>
                    </Button>
                  </Can>
                )}
                <Can I="update" a="Timetable">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!timetableId}
                    onClick={() => setOverrideSlot(slot)}
                    data-testid={instituteTimetable.dayOverrideBtn(slot.periodId)}
                  >
                    {t('day.override')}
                  </Button>
                </Can>
              </div>
            </div>
          ))}
        </div>
      )}

      {sectionId && timetableId && (
        <OverrideList timetableId={timetableId} date={date} sectionId={sectionId} />
      )}

      {overrideSlot && timetableId && sectionId && (
        <OverrideDialog
          timetableId={timetableId}
          sectionId={sectionId}
          date={date}
          slot={overrideSlot}
          open={!!overrideSlot}
          onOpenChange={(open) => !open && setOverrideSlot(null)}
        />
      )}
    </div>
  );
}

function OverrideList({
  timetableId,
  date,
  sectionId,
}: {
  timetableId: string;
  date: string;
  sectionId: string;
}) {
  const t = useTranslations('timetable');
  const lookups = useTimetableLookups();
  const { overrides } = useTimetableDayOverrides(timetableId, date);
  const { clearOverride } = useClearTimetableDayOverride();

  const sectionOverrides = overrides.filter((o) => o.sectionId === sectionId);
  if (sectionOverrides.length === 0) return null;

  const handleClear = async (id: string) => {
    try {
      await clearOverride(id);
      toast.success(t('day.overrideCleared'));
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">{t('day.manageOverride')}</h2>
      <div className="rounded-md border">
        {sectionOverrides.map((o) => (
          <div
            key={o.id}
            className="flex items-center justify-between gap-2 border-b p-3 text-sm last:border-b-0"
          >
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{t(`overrideTypes.${o.overrideType}`)}</Badge>
              <span>
                {lookups.subjectLabel(o.subjectId)}
                {o.teacherId && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {lookups.teacherLabel(o.teacherId)}
                  </span>
                )}
                {o.reason && <span className="text-muted-foreground"> · {o.reason}</span>}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => handleClear(o.id)}
              data-testid={instituteTimetable.dayClearOverrideBtn(o.id)}
            >
              {t('day.clearOverride')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverrideDialog({
  timetableId,
  sectionId,
  date,
  slot,
  open,
  onOpenChange,
}: {
  timetableId: string;
  sectionId: string;
  date: string;
  slot: DayScheduleSlot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('timetable');
  const lookups = useTimetableLookups();
  const { createOverride, loading } = useCreateTimetableDayOverride();

  const [type, setType] = React.useState<TimetableOverrideType>('SUBSTITUTION');
  const [subjectId, setSubjectId] = React.useState<string>('');
  const [teacherId, setTeacherId] = React.useState<string>('');
  const [room, setRoom] = React.useState<string>(slot.room ?? '');
  const [reason, setReason] = React.useState<string>('');

  const subjectOptions = lookups.subjectGroups.flatMap((g) => g.options);

  const handleSubmit = async () => {
    try {
      await createOverride({
        timetableId,
        date,
        sectionId,
        periodId: slot.periodId,
        splitIndex: slot.splitIndex,
        overrideType: type,
        subjectId: subjectId || null,
        teacherId: teacherId || null,
        room: room || null,
        reason: reason || null,
      });
      toast.success(t('day.overrideCreated'));
      onOpenChange(false);
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[85vh] overflow-y-auto"
        data-testid={instituteTimetable.overrideDialog}
      >
        <DialogHeader>
          <DialogTitle>
            {t('override.dialogTitle')} · {slot.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field>
            <FieldLabel>{t('override.type')}</FieldLabel>
            <Select value={type} onValueChange={(v) => setType(v as TimetableOverrideType)}>
              <SelectTrigger
                data-testid={instituteTimetable.overrideTypeSelect}
                aria-label={t('override.type')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OVERRIDE_TYPES.map((ot) => (
                  <SelectItem key={ot} value={ot}>
                    {t(`overrideTypes.${ot}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t('override.subject')}</FieldLabel>
            <Select value={subjectId || undefined} onValueChange={setSubjectId}>
              <SelectTrigger
                data-testid={instituteTimetable.overrideSubjectSelect}
                aria-label={t('override.subject')}
              >
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
            <FieldLabel>{t('override.teacher')}</FieldLabel>
            <Select value={teacherId || undefined} onValueChange={setTeacherId}>
              <SelectTrigger
                data-testid={instituteTimetable.overrideTeacherSelect}
                aria-label={t('override.teacher')}
              >
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
            <FieldLabel>{t('override.room')}</FieldLabel>
            <Input
              value={room}
              placeholder={t('assign.roomPlaceholder')}
              onChange={(e) => setRoom(e.target.value)}
              data-testid={instituteTimetable.overrideRoomInput}
            />
          </Field>
          <Field>
            <FieldLabel>{t('override.reason')}</FieldLabel>
            <Textarea
              value={reason}
              placeholder={t('override.reasonPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
              data-testid={instituteTimetable.overrideReasonInput}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid={instituteTimetable.overrideCancelBtn}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={loading}
            onClick={handleSubmit}
            data-testid={instituteTimetable.overrideSubmitBtn}
          >
            {loading ? t('override.saving') : t('override.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
