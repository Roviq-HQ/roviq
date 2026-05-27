'use client';

import { buildI18nTextSchema, useFormatDate, useI18nField, zodValidator } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  I18nField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  useAppForm,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { type ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { SectionPicker } from '@web/components/pickers/section-picker';
import { CalendarClock, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import * as React from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { AcademicYearSelector, useSelectedAcademicYear } from '../academic-years/year-selector';
import { useStandards } from '../academics/use-academics';
import { mapError, TimeInput } from './timetable-shared';
import {
  type CreateTimetableInput,
  type DaySession,
  type TimetableListItem,
  type TimetableStatus,
  useCreateTimetable,
  useDeleteTimetable,
  useRestoreTimetable,
  useTimetables,
  useUpdateTimetableStatus,
  type Weekday,
} from './use-timetable';

const { instituteTimetable } = testIds;

const STATUS_COLORS: Record<TimetableStatus, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-600',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  INACTIVE: 'bg-amber-100 text-amber-700',
  ARCHIVED: 'bg-zinc-100 text-zinc-400',
};

const WEEKDAY_VALUES: Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];
const STATUS_VALUES: TimetableStatus[] = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
const DEFAULT_WORKING_DAYS: Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];
const SESSION_VALUES: DaySession[] = ['MORNING', 'EVENING'];
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;
const ALL_STATUSES = '__all__';

export default function TimetablePage() {
  const t = useTranslations('timetable');
  const params = useParams();
  const locale = params.locale as string;
  const resolveI18n = useI18nField();
  const { format } = useFormatDate();
  const { yearId } = useSelectedAcademicYear();

  const [status, setStatus] = useQueryState('status', parseAsString);
  const [search, setSearch] = useQueryState('q', parseAsString);
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [perPage, setPerPage] = useQueryState('perPage', parseAsInteger.withDefault(20));

  const [deleteTarget, setDeleteTarget] = React.useState<TimetableListItem | null>(null);

  const { timetables, total, totalPages, loading } = useTimetables(yearId, {
    status: (status as TimetableStatus | null) ?? null,
    search,
    page,
    perPage,
  });

  const { updateStatus } = useUpdateTimetableStatus();
  const { restoreTimetable } = useRestoreTimetable();

  const handleToggleStatus = async (item: TimetableListItem) => {
    const next: TimetableStatus = item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await updateStatus(item.id, next);
      toast.success(next === 'ACTIVE' ? t('editor.activated') : t('editor.deactivated'));
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };

  const handleRestore = async (item: TimetableListItem) => {
    try {
      await restoreTimetable([item.id]);
      toast.success(t('restored'));
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };

  const columnHelper = createColumnHelper<TimetableListItem>();
  const columns: ColumnDef<TimetableListItem, unknown>[] = [
    columnHelper.accessor('name', {
      header: t('name'),
      cell: ({ row }) => (
        <Link
          href={`/${locale}/institute/timetable/${row.original.id}`}
          className="font-medium text-primary hover:underline"
          data-testid={instituteTimetable.rowLink(row.original.id)}
        >
          {resolveI18n(row.original.name)}
        </Link>
      ),
    }) as ColumnDef<TimetableListItem, unknown>,
    columnHelper.accessor('effectiveFrom', {
      header: t('effectiveFrom'),
      cell: ({ row }) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {format(new Date(`${row.original.effectiveFrom}T00:00:00`), 'dd/MM/yyyy')} –{' '}
          {format(new Date(`${row.original.effectiveTo}T00:00:00`), 'dd/MM/yyyy')}
        </span>
      ),
    }) as ColumnDef<TimetableListItem, unknown>,
    columnHelper.accessor('workingDays', {
      header: t('wizard.workingDays'),
      cell: ({ getValue }) => (
        <span className="text-sm tabular-nums">{(getValue() as Weekday[]).length}</span>
      ),
    }) as ColumnDef<TimetableListItem, unknown>,
    columnHelper.accessor('status', {
      header: t('status'),
      cell: ({ getValue }) => {
        const value = getValue() as TimetableStatus;
        return (
          <Badge variant="secondary" className={`border-0 ${STATUS_COLORS[value]}`}>
            {t(`statuses.${value}`)}
          </Badge>
        );
      },
    }) as ColumnDef<TimetableListItem, unknown>,
    columnHelper.display({
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Can I="update" a="Timetable">
            <Button
              variant="ghost"
              size="sm"
              title={t('edit')}
              aria-label={t('edit')}
              onClick={() => handleToggleStatus(row.original)}
              disabled={row.original.status === 'ARCHIVED'}
              data-testid={instituteTimetable.statusToggle(row.original.id)}
            >
              {row.original.status === 'ACTIVE' ? t('editor.deactivate') : t('editor.activate')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title={t('edit')}
              aria-label={t('edit')}
              asChild
              data-testid={instituteTimetable.editBtn(row.original.id)}
            >
              <Link href={`/${locale}/institute/timetable/${row.original.id}`}>
                <Pencil className="size-3.5" />
              </Link>
            </Button>
          </Can>
          <Can I="delete" a="Timetable">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              title={t('delete')}
              aria-label={t('delete')}
              onClick={() => setDeleteTarget(row.original)}
              data-testid={instituteTimetable.deleteBtn(row.original.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
            {row.original.status === 'ARCHIVED' && (
              <Button
                variant="ghost"
                size="sm"
                title={t('restore')}
                aria-label={t('restore')}
                onClick={() => handleRestore(row.original)}
                data-testid={instituteTimetable.restoreBtn(row.original.id)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            )}
          </Can>
        </div>
      ),
    }) as ColumnDef<TimetableListItem, unknown>,
  ];

  if (!yearId) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock />
            </EmptyMedia>
            <EmptyTitle>{t('selectYear')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <Can I="read" a="Timetable" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-6" data-testid={instituteTimetable.page}>
            <PageHeader yearId={yearId} />

            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder={t('search')}
                value={search ?? ''}
                onChange={(e) => {
                  void setSearch(e.target.value || null);
                  void setPage(1);
                }}
                className="max-w-xs"
                data-testid={instituteTimetable.searchInput}
              />
              <Select
                value={status ?? ALL_STATUSES}
                onValueChange={(v) => {
                  void setStatus(v === ALL_STATUSES ? null : v);
                  void setPage(1);
                }}
              >
                <SelectTrigger
                  className="w-40"
                  aria-label={t('filterStatus')}
                  data-testid={instituteTimetable.statusFilter}
                >
                  <SelectValue placeholder={t('filterStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUSES}>{t('allStatuses')}</SelectItem>
                  {STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`statuses.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DataTable
              columns={columns}
              data={timetables}
              isLoading={loading}
              skeletonRows={5}
              data-testid={instituteTimetable.table}
              emptyState={
                <Empty data-testid={instituteTimetable.emptyState}>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <CalendarClock />
                    </EmptyMedia>
                    <EmptyTitle>{search || status ? t('noMatch') : t('noTimetables')}</EmptyTitle>
                    <EmptyDescription>{t('noTimetablesDescription')}</EmptyDescription>
                  </EmptyHeader>
                  <Can I="create" a="Timetable">
                    <CreateTimetableWizard
                      yearId={yearId}
                      triggerTestId={instituteTimetable.emptyCreateButton}
                    />
                  </Can>
                </Empty>
              }
            />

            <Pagination
              total={total}
              page={page}
              perPage={perPage}
              totalPages={totalPages}
              onPage={(p) => void setPage(p)}
              onPerPage={(pp) => {
                void setPerPage(pp);
                void setPage(1);
              }}
            />

            <DeleteTimetableDialog
              target={deleteTarget}
              open={!!deleteTarget}
              onOpenChange={(open) => !open && setDeleteTarget(null)}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center min-h-[400px]">
            <p className="text-muted-foreground" data-testid={instituteTimetable.accessDenied}>
              {t('accessDenied')}
            </p>
          </div>
        )
      }
    </Can>
  );
}

function PageHeader({ yearId }: { yearId?: string | null }) {
  const t = useTranslations('timetable');
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold tracking-tight" data-testid={instituteTimetable.title}>
        {t('title')}
      </h1>
      <div className="flex items-center gap-3">
        <AcademicYearSelector />
        <Can I="create" a="Timetable">
          {yearId && <CreateTimetableWizard yearId={yearId} />}
        </Can>
      </div>
    </div>
  );
}

function Pagination({
  total,
  page,
  perPage,
  totalPages,
  onPage,
  onPerPage,
}: {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  onPage: (p: number) => void;
  onPerPage: (pp: number) => void;
}) {
  const t = useTranslations('timetable');
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t('rowsPerPage')}</span>
        <Select value={String(perPage)} onValueChange={(v) => onPerPage(Number(v))}>
          <SelectTrigger
            className="w-20"
            aria-label={t('rowsPerPage')}
            data-testid={instituteTimetable.pageSizeSelect}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 20, 50].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t('pageOf', { page, total: totalPages })}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          data-testid={instituteTimetable.prevPageBtn}
        >
          {t('previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          data-testid={instituteTimetable.nextPageBtn}
        >
          {t('next')}
        </Button>
      </div>
    </div>
  );
}

interface LunchRow {
  name: string;
  afterPeriod: number;
  duration: number;
}
interface ExtraRow {
  session: DaySession;
  startTime: string;
  duration: number;
  count: number;
}
interface WizardForm {
  name: Record<string, string>;
  description: string;
  sectionIds: string[];
  effectiveFrom: string;
  effectiveTo: string;
  dayStartTime: string;
  defaultPeriodDurationMins: number;
  periodsCount: number;
  workingDays: Weekday[];
  lunch: LunchRow[];
  extraClass: ExtraRow[];
}

const EMPTY_WIZARD: WizardForm = {
  name: { en: '', hi: '' },
  description: '',
  sectionIds: [],
  effectiveFrom: '',
  effectiveTo: '',
  dayStartTime: '08:00',
  defaultPeriodDurationMins: 45,
  periodsCount: 6,
  workingDays: DEFAULT_WORKING_DAYS,
  lunch: [],
  extraClass: [],
};

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function buildWizardSchema(t: ReturnType<typeof useTranslations<'timetable'>>) {
  return z.object({
    name: buildI18nTextSchema(t('errors.TIMETABLE_NAME_DUPLICATE')),
    description: z.string(),
    sectionIds: z.array(z.string()).min(1),
    effectiveFrom: z.string().regex(DATE_REGEX),
    effectiveTo: z.string().regex(DATE_REGEX),
    dayStartTime: z.string().regex(TIME_REGEX),
    defaultPeriodDurationMins: z.number().int().min(1),
    periodsCount: z.number().int().min(1),
    workingDays: z.array(z.enum(WEEKDAY_VALUES)).min(1),
    lunch: z.array(
      z.object({
        name: z.string().trim().min(1),
        afterPeriod: z.number().int().min(1),
        duration: z.number().int().min(1),
      }),
    ),
    extraClass: z.array(
      z.object({
        session: z.enum(['MORNING', 'EVENING']),
        startTime: z.string().regex(TIME_REGEX),
        duration: z.number().int().min(1),
        count: z.number().int().min(1),
      }),
    ),
  });
}

function CreateTimetableWizard({
  yearId,
  triggerTestId = instituteTimetable.createButton,
}: {
  yearId: string;
  triggerTestId?: string;
}) {
  const t = useTranslations('timetable');
  const [open, setOpen] = React.useState(false);
  const { createTimetable, loading } = useCreateTimetable();
  const { standards } = useStandards(yearId);
  const schema = React.useMemo(() => buildWizardSchema(t), [t]);

  const form = useAppForm({
    defaultValues: EMPTY_WIZARD,
    validators: { onSubmit: zodValidator(schema) },
    onSubmit: async ({ value }) => {
      const parsed = schema.parse(value);
      const input: CreateTimetableInput = {
        name: parsed.name,
        description: parsed.description || null,
        academicYearId: yearId,
        sectionIds: parsed.sectionIds,
        effectiveFrom: parsed.effectiveFrom,
        effectiveTo: parsed.effectiveTo,
        dayStartTime: parsed.dayStartTime,
        defaultPeriodDurationMins: parsed.defaultPeriodDurationMins,
        periodsCount: parsed.periodsCount,
        workingDays: parsed.workingDays,
        // Form uses `duration`; the GraphQL input field is `durationMins`.
        lunch: parsed.lunch.map((l) => ({
          name: l.name,
          afterPeriod: l.afterPeriod,
          durationMins: l.duration,
        })),
        extraClass: parsed.extraClass.map((e) => ({
          session: e.session,
          startTime: e.startTime,
          durationMins: e.duration,
          count: e.count,
        })),
      };
      try {
        await createTimetable(input);
        toast.success(t('created'));
        form.reset(EMPTY_WIZARD);
        setOpen(false);
      } catch (err) {
        toast.error(mapError(err, t));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" className="gap-2" onClick={() => setOpen(true)} data-testid={triggerTestId}>
        <Plus className="size-4" aria-hidden="true" />
        {t('create')}
      </Button>
      <DialogContent
        className="flex h-[90vh] max-h-[90vh] w-[92vw] max-w-[1400px] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[1400px]"
        data-testid={instituteTimetable.wizard}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t('wizard.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('wizard.title')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">
            <div className="mx-auto grid w-full max-w-none grid-cols-1 items-start gap-x-12 gap-y-6 lg:grid-cols-2">
              <div className="space-y-6">
                <FieldGroup>
                  <I18nField
                    form={form}
                    name="name"
                    label={t('name')}
                    placeholder={t('namePlaceholder')}
                    testId={instituteTimetable.wizardNameInput}
                  />
                  <form.AppField name="description">
                    {(field) => (
                      <field.TextareaField
                        label={t('descriptionLabel')}
                        placeholder={t('descriptionPlaceholder')}
                        testId={instituteTimetable.wizardDescriptionInput}
                      />
                    )}
                  </form.AppField>
                </FieldGroup>

                {/* Sections covered */}
                <FieldSet>
                  <FieldLegend variant="label">{t('wizard.selectSections')}</FieldLegend>
                  <FieldDescription>{t('wizard.selectSectionsHint')}</FieldDescription>
                  <form.Field name="sectionIds">
                    {(field) => (
                      <SectionPicker
                        standards={standards}
                        selected={(field.state.value as string[]) ?? []}
                        onToggle={(id) => {
                          const current = (field.state.value as string[]) ?? [];
                          field.handleChange(
                            current.includes(id)
                              ? current.filter((x) => x !== id)
                              : [...current, id],
                          );
                        }}
                        onSetMany={(ids, select) => {
                          const set = new Set((field.state.value as string[]) ?? []);
                          for (const id of ids) {
                            if (select) set.add(id);
                            else set.delete(id);
                          }
                          field.handleChange([...set]);
                        }}
                      />
                    )}
                  </form.Field>
                </FieldSet>
              </div>
              <div className="space-y-6">
                {/* Schedule setup */}
                <FieldSet>
                  <FieldLegend variant="label">{t('wizard.scheduleSection')}</FieldLegend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="tt-effective-from">{t('effectiveFrom')}</FieldLabel>
                      <Input
                        id="tt-effective-from"
                        type="date"
                        value={form.state.values.effectiveFrom}
                        onChange={(e) => form.setFieldValue('effectiveFrom', e.target.value)}
                        data-testid={instituteTimetable.wizardEffectiveFromInput}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="tt-effective-to">{t('effectiveTo')}</FieldLabel>
                      <Input
                        id="tt-effective-to"
                        type="date"
                        value={form.state.values.effectiveTo}
                        onChange={(e) => form.setFieldValue('effectiveTo', e.target.value)}
                        data-testid={instituteTimetable.wizardEffectiveToInput}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <TimeInput
                      label={t('wizard.dayStartTime')}
                      value={form.state.values.dayStartTime}
                      onChange={(v) => form.setFieldValue('dayStartTime', v)}
                      testId={instituteTimetable.wizardDayStartInput}
                    />
                    <form.AppField name="defaultPeriodDurationMins">
                      {(field) => (
                        <field.NumberField
                          label={t('wizard.periodDuration')}
                          min={1}
                          testId={instituteTimetable.wizardPeriodDurationInput}
                        />
                      )}
                    </form.AppField>
                    <form.AppField name="periodsCount">
                      {(field) => (
                        <field.NumberField
                          label={t('wizard.periodsCount')}
                          min={1}
                          testId={instituteTimetable.wizardPeriodsCountInput}
                        />
                      )}
                    </form.AppField>
                  </div>

                  <Field>
                    <FieldLabel>{t('wizard.workingDays')}</FieldLabel>
                    <form.Field name="workingDays">
                      {(field) => {
                        const selected = (field.state.value as Weekday[]) ?? [];
                        return (
                          <div className="flex flex-wrap gap-3">
                            {WEEKDAY_VALUES.map((day) => {
                              const id = `tt-wizard-working-day-${day}`;
                              return (
                                <div key={day} className="flex items-center gap-1.5 text-sm">
                                  <Checkbox
                                    id={id}
                                    checked={selected.includes(day)}
                                    onCheckedChange={(next) =>
                                      field.handleChange(
                                        next === true
                                          ? [...selected, day]
                                          : selected.filter((d) => d !== day),
                                      )
                                    }
                                    data-testid={instituteTimetable.wizardWorkingDay(day)}
                                  />
                                  <FieldLabel htmlFor={id} className="cursor-pointer">
                                    {t(`weekdaysShort.${day}`)}
                                  </FieldLabel>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }}
                    </form.Field>
                  </Field>
                </FieldSet>

                <Separator />

                {/* Lunch breaks */}
                <FieldSet>
                  <div className="flex items-center justify-between">
                    <FieldLegend variant="label">{t('wizard.lunchBreaks')}</FieldLegend>
                    <form.Field name="lunch" mode="array">
                      {(field) => (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs"
                          onClick={() =>
                            field.pushValue({ name: '', afterPeriod: 3, duration: 30 })
                          }
                          data-testid={instituteTimetable.wizardAddLunchBtn}
                        >
                          <Plus className="size-3" /> {t('wizard.addLunch')}
                        </Button>
                      )}
                    </form.Field>
                  </div>
                  <FieldDescription>{t('wizard.lunchBreaksHint')}</FieldDescription>
                  <form.Field name="lunch" mode="array">
                    {(field) => {
                      const rows = (field.state.value as LunchRow[]) ?? [];
                      if (rows.length === 0) {
                        return (
                          <p className="text-sm text-muted-foreground">{t('wizard.lunchEmpty')}</p>
                        );
                      }
                      return (
                        <div className="space-y-2">
                          {rows.map((_, i) => (
                            <div
                              // biome-ignore lint/suspicious/noArrayIndexKey: positional row identity inside an editable array.
                              key={i}
                              className="flex items-end gap-2 rounded-lg border bg-muted/30 p-2"
                            >
                              <form.AppField name={`lunch[${i}].name`}>
                                {(f) => (
                                  <f.TextField
                                    label={t('wizard.lunchName')}
                                    placeholder="Lunch"
                                    testId={instituteTimetable.wizardLunchNameInput(i)}
                                  />
                                )}
                              </form.AppField>
                              <form.AppField name={`lunch[${i}].afterPeriod`}>
                                {(f) => (
                                  <f.NumberField
                                    label={t('wizard.lunchAfter')}
                                    min={1}
                                    testId={instituteTimetable.wizardLunchAfterInput(i)}
                                  />
                                )}
                              </form.AppField>
                              <form.AppField name={`lunch[${i}].duration`}>
                                {(f) => (
                                  <f.NumberField
                                    label={t('wizard.lunchDuration')}
                                    min={1}
                                    testId={instituteTimetable.wizardLunchDurationInput(i)}
                                  />
                                )}
                              </form.AppField>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => field.removeValue(i)}
                                title={t('wizard.removeLunch')}
                                aria-label={t('wizard.removeLunch')}
                                data-testid={instituteTimetable.wizardRemoveLunchBtn(i)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  </form.Field>
                </FieldSet>

                {/* Extra classes */}
                <FieldSet>
                  <div className="flex items-center justify-between">
                    <FieldLegend variant="label">{t('wizard.extraClasses')}</FieldLegend>
                    <form.Field name="extraClass" mode="array">
                      {(field) => (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs"
                          onClick={() =>
                            field.pushValue({
                              session: 'MORNING',
                              startTime: '07:15',
                              duration: 30,
                              count: 1,
                            })
                          }
                          data-testid={instituteTimetable.wizardAddExtraBtn}
                        >
                          <Plus className="size-3" /> {t('wizard.addExtra')}
                        </Button>
                      )}
                    </form.Field>
                  </div>
                  <FieldDescription>{t('wizard.extraClassesHint')}</FieldDescription>
                  <form.Field name="extraClass" mode="array">
                    {(field) => {
                      const rows = (field.state.value as ExtraRow[]) ?? [];
                      if (rows.length === 0) {
                        return (
                          <p className="text-sm text-muted-foreground">{t('wizard.extraEmpty')}</p>
                        );
                      }
                      return (
                        <div className="space-y-2">
                          {rows.map((row, i) => (
                            <div
                              // biome-ignore lint/suspicious/noArrayIndexKey: positional row identity inside an editable array.
                              key={i}
                              className="flex items-end gap-2 rounded-lg border bg-muted/30 p-2"
                            >
                              <Field className="w-28">
                                <FieldLabel>{t('wizard.extraSession')}</FieldLabel>
                                <Select
                                  value={row.session}
                                  onValueChange={(v) =>
                                    field.replaceValue(i, { ...row, session: v as DaySession })
                                  }
                                >
                                  <SelectTrigger
                                    data-testid={instituteTimetable.wizardExtraSessionSelect(i)}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SESSION_VALUES.map((s) => (
                                      <SelectItem key={s} value={s}>
                                        {t(`sessions.${s}`)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                              <TimeInput
                                label={t('wizard.extraStart')}
                                value={row.startTime}
                                onChange={(v) => field.replaceValue(i, { ...row, startTime: v })}
                                testId={instituteTimetable.wizardExtraStartInput(i)}
                              />
                              <form.AppField name={`extraClass[${i}].duration`}>
                                {(f) => (
                                  <f.NumberField
                                    label={t('wizard.extraDuration')}
                                    min={1}
                                    testId={instituteTimetable.wizardExtraDurationInput(i)}
                                  />
                                )}
                              </form.AppField>
                              <form.AppField name={`extraClass[${i}].count`}>
                                {(f) => (
                                  <f.NumberField
                                    label={t('wizard.extraCount')}
                                    min={1}
                                    testId={instituteTimetable.wizardExtraCountInput(i)}
                                  />
                                )}
                              </form.AppField>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => field.removeValue(i)}
                                title={t('wizard.removeExtra')}
                                aria-label={t('wizard.removeExtra')}
                                data-testid={instituteTimetable.wizardRemoveExtraBtn(i)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  </form.Field>
                </FieldSet>
              </div>
            </div>
          </div>
          {/* Plain footer (not DialogFooter — its -mx-4/-mb-4 negative margins
              assume a p-4 dialog and misalign in this p-0 full-bleed layout). */}
          <div className="mt-auto flex items-center justify-end gap-2 border-t bg-muted/30 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              data-testid={instituteTimetable.wizardCancelBtn}
            >
              {t('cancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton
                disabled={loading}
                submittingLabel={t('creating')}
                testId={instituteTimetable.wizardSubmitBtn}
              >
                {t('create')}
              </form.SubmitButton>
            </form.AppForm>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTimetableDialog({
  target,
  open,
  onOpenChange,
}: {
  target: TimetableListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('timetable');
  const resolveI18n = useI18nField();
  const { deleteTimetable, loading } = useDeleteTimetable();

  const handleDelete = async () => {
    if (!target) return;
    try {
      await deleteTimetable([target.id]);
      toast.success(t('deleted'));
      onOpenChange(false);
    } catch (err) {
      toast.error(mapError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid={instituteTimetable.deleteDialog}>
        <DialogHeader>
          <DialogTitle>{t('deleteConfirmTitle', { name: resolveI18n(target?.name) })}</DialogTitle>
          <DialogDescription>{t('deleteConfirmDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid={instituteTimetable.deleteCancelBtn}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={loading}
            onClick={handleDelete}
            data-testid={instituteTimetable.deleteConfirmBtn}
          >
            {loading ? t('deleting') : t('delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
