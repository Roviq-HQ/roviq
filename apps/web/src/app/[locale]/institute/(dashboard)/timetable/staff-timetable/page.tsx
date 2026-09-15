'use client';

import { decodeJwt, useAuth } from '@roviq/auth';
import { useFormatDate } from '@roviq/i18n';
import {
  Button,
  Can,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { CalendarClock, Download, Loader2, Printer } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { ReadOnlyGrid } from '../read-only-grid';
import { downloadBase64Pdf } from '../timetable-shared';
import { useStaffTimetable, useStaffTimetablePdf, useTimetables } from '../use-timetable';
import { TimetableLookupsProvider, useTimetableLookups } from '../use-timetable-lookups';

const { instituteTimetable } = testIds;
const SELF = '__self__';

export default function StaffTimetablePage() {
  const t = useTranslations('timetable');
  // Scope the grid to the active year's ACTIVE timetable (the backend
  // resolves the year). null = nothing active, so the grid stays empty.
  const { timetables, loading: timetablesLoading } = useTimetables({ status: 'ACTIVE' });
  const timetableId = timetablesLoading ? undefined : (timetables[0]?.id ?? null);

  return (
    <Can I="read" a="Timetable" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <TimetableLookupsProvider>
            <StaffTimetableInner timetableId={timetableId} timetablesLoading={timetablesLoading} />
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

function StaffTimetableInner({
  timetableId,
  timetablesLoading,
}: {
  timetableId?: string | null;
  timetablesLoading: boolean;
}) {
  const t = useTranslations('timetable');
  const { format } = useFormatDate();
  const lookups = useTimetableLookups();
  const { getAccessToken, memberships, user } = useAuth();
  // `__self__` resolves to the caller's membership id for the active institute
  // (teacher id == membership id). Prefer the signed-in user's membership id —
  // the same identity TodayScheduleCard uses — so both views always agree.
  // The JWT tenant+role match below is only a fallback: a stale role in the
  // token matches no listed membership, which skips the grid query entirely
  // (skipped queries report loading:false) and shows the empty state.
  const selfMembershipId = React.useMemo(() => {
    if (user?.membershipId) return user.membershipId;
    const claims = decodeJwt(getAccessToken() ?? '');
    if (!claims) return null;
    return (
      memberships?.find((m) => m.tenantId === claims.tenantId && m.roleId === claims.roleId)
        ?.membershipId ?? null
    );
  }, [user?.membershipId, getAccessToken, memberships]);
  // Deep-link support: ?teacher=<membershipId> (from staff detail page).
  const searchParams = useSearchParams();
  const [selected, setSelected] = React.useState<string>(() => searchParams.get('teacher') ?? SELF);
  const teacherId = selected === SELF ? selfMembershipId : selected;
  // A picked year with no ACTIVE timetable is an empty grid — never show
  // another year's timetable behind the picker's back.
  const effectiveTeacherId = timetableId === null ? null : teacherId;
  const { grid, loading, error, refetch } = useStaffTimetable(
    effectiveTeacherId,
    timetableId ?? undefined,
  );
  const busy = timetablesLoading || loading;
  // Print header shows who the grid belongs to: the server-resolved display
  // name first (teacher-role callers cannot read the staff directory, so the
  // client often has no label), then the picked option or sign-in name.
  const selectedTeacherLabel =
    grid?.teacherName ??
    (selected === SELF
      ? (user?.username ?? t('view.self'))
      : (lookups.teacherOptions.find((option) => option.value === selected)?.label ?? ''));
  const [fetchPdf, { loading: pdfLoading }] = useStaffTimetablePdf();

  const handleDownloadPdf = React.useCallback(async () => {
    if (!effectiveTeacherId) return;
    try {
      const { data } = await fetchPdf({
        variables: { teacherId: effectiveTeacherId, timetableId: timetableId ?? undefined },
      });
      if (data?.staffTimetablePdf) {
        downloadBase64Pdf(data.staffTimetablePdf, 'staff-timetable.pdf');
      }
    } catch {
      toast.error(t('view.downloadFailed'));
    }
  }, [fetchPdf, effectiveTeacherId, timetableId, t]);

  return (
    <div className="space-y-6 print-document" data-testid={instituteTimetable.staffTimetablePage}>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1
          className="text-2xl font-semibold tracking-tight"
          data-testid={instituteTimetable.staffTimetableTitle}
        >
          {t('view.staffTitle')}
        </h1>
        <div className="flex items-center gap-3">
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

      {/* The picker only offers choices when the staff directory loads:
          teachers (who cannot read it) see just their own grid. */}
      {(lookups.loading || lookups.teacherOptions.length > 0) && (
        <div className="print:hidden">
          <Field className="w-64">
            <FieldLabel>{t('view.selectTeacher')}</FieldLabel>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger
                data-testid={instituteTimetable.staffTeacherSelect}
                aria-label={t('view.selectTeacher')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELF}>{t('view.self')}</SelectItem>
                {lookups.teacherOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      {busy ? (
        <div className="h-48 flex items-center justify-center">
          <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : error ? (
        <Empty className="print:hidden" data-testid={instituteTimetable.staffGridError}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock />
            </EmptyMedia>
            <EmptyTitle>{t('view.loadFailed')}</EmptyTitle>
          </EmptyHeader>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            data-testid={instituteTimetable.staffGridRetryBtn}
          >
            {t('view.retry')}
          </Button>
        </Empty>
      ) : !grid ? (
        <Empty className="print:hidden">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock />
            </EmptyMedia>
            <EmptyTitle>{t('view.noTimetable')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3">
          <div className="hidden print:block" data-testid={instituteTimetable.staffPrintHeader}>
            <h2 className="text-lg font-semibold">{t('view.staffTitle')}</h2>
            {selectedTeacherLabel ? (
              <p className="text-sm text-muted-foreground">{selectedTeacherLabel}</p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {t('view.printedOn', { date: format(new Date(), 'dd/MM/yyyy') })}
            </p>
          </div>
          <ReadOnlyGrid grid={grid} showSection testId={instituteTimetable.staffGrid} />
        </div>
      )}
    </div>
  );
}
