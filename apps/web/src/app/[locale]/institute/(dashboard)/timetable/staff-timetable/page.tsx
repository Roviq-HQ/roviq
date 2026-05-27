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
import { AcademicYearSelector, useSelectedAcademicYear } from '../../academic-years/year-selector';
import { ReadOnlyGrid } from '../read-only-grid';
import { downloadBase64Pdf } from '../timetable-shared';
import { useStaffTimetable, useStaffTimetablePdf } from '../use-timetable';
import { TimetableLookupsProvider, useTimetableLookups } from '../use-timetable-lookups';

const { instituteTimetable } = testIds;
const SELF = '__self__';

export default function StaffTimetablePage() {
  const t = useTranslations('timetable');
  const { yearId } = useSelectedAcademicYear();

  return (
    <Can I="read" a="Timetable" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <TimetableLookupsProvider academicYearId={yearId}>
            <StaffTimetableInner />
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

function StaffTimetableInner() {
  const t = useTranslations('timetable');
  const { format } = useFormatDate();
  const lookups = useTimetableLookups();
  const { getAccessToken, memberships } = useAuth();
  // `__self__` resolves to the caller's membership id for the active institute
  // (teacher id == membership id). The JWT carries tenantId + roleId, which
  // uniquely identify the membership within the loaded list.
  const selfMembershipId = React.useMemo(() => {
    const claims = decodeJwt(getAccessToken() ?? '');
    if (!claims) return null;
    return (
      memberships?.find((m) => m.tenantId === claims.tenantId && m.roleId === claims.roleId)
        ?.membershipId ?? null
    );
  }, [getAccessToken, memberships]);
  // Deep-link support: ?teacher=<membershipId> (from staff detail page).
  const searchParams = useSearchParams();
  const [selected, setSelected] = React.useState<string>(() => searchParams.get('teacher') ?? SELF);
  const teacherId = selected === SELF ? selfMembershipId : selected;
  const { grid, loading } = useStaffTimetable(teacherId);
  const [fetchPdf, { loading: pdfLoading }] = useStaffTimetablePdf();

  const handleDownloadPdf = React.useCallback(async () => {
    if (!teacherId) return;
    try {
      const { data } = await fetchPdf({ variables: { teacherId } });
      if (data?.staffTimetablePdf) {
        downloadBase64Pdf(data.staffTimetablePdf, 'staff-timetable.pdf');
      }
    } catch {
      toast.error(t('view.downloadFailed'));
    }
  }, [fetchPdf, teacherId, t]);

  return (
    <div className="space-y-6" data-testid={instituteTimetable.staffTimetablePage}>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1
          className="text-2xl font-semibold tracking-tight"
          data-testid={instituteTimetable.staffTimetableTitle}
        >
          {t('view.staffTitle')}
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

      {loading ? (
        <div className="h-48 flex items-center justify-center">
          <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
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
          <p className="hidden text-sm text-muted-foreground print:block">
            {t('view.printedOn', { date: format(new Date(), 'dd/MM/yyyy') })}
          </p>
          <ReadOnlyGrid grid={grid} showSection testId={instituteTimetable.staffGrid} />
        </div>
      )}
    </div>
  );
}
