'use client';

import {
  type ComplianceReportType,
  type ExportReportStatus,
  eligibleComplianceReportTypes,
} from '@roviq/common-types';
import { extractGraphQLErrorCode, gql, useMutation, useQuery } from '@roviq/graphql';
import { useFormatDate, useFormatNumber, useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { FileDownloadButton } from '@web/components/file-upload/file-download-button';
import { FileSpreadsheet, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

const { adminInstituteDetail: ids } = testIds;

/** How often the history is re-read while an export is queued or generating. */
export const EXPORT_POLL_INTERVAL_MS = 3000;

export const ADMIN_LIST_EXPORT_ACADEMIC_YEARS = gql`
  query AdminListExportAcademicYears($instituteId: ID!) {
    adminListExportAcademicYears(instituteId: $instituteId) {
      id
      label
      isActive
    }
  }
`;

export const ADMIN_LIST_EXPORT_REPORTS = gql`
  query AdminListExportReports($instituteId: ID!) {
    adminListExportReports(instituteId: $instituteId) {
      id
      reportType
      academicYearId
      academicYearLabel
      status
      rowCount
      errorCode
      requesterFirstName
      requesterLastName
      requestedAt
      completedAt
      file {
        id
        sizeBytes
      }
    }
  }
`;

export const ADMIN_EXPORT_COMPLIANCE_REPORT = gql`
  mutation AdminExportComplianceReport($input: AdminExportComplianceReportInput!) {
    adminExportComplianceReport(input: $input) {
      id
      status
    }
  }
`;

export interface ExportAcademicYear {
  id: string;
  label: string;
  isActive: boolean;
}

export interface ExportReportRow {
  id: string;
  reportType: ComplianceReportType;
  academicYearId: string;
  academicYearLabel: string | null;
  status: ExportReportStatus;
  rowCount: number | null;
  errorCode: string | null;
  requesterFirstName: Record<string, string> | null;
  requesterLastName: Record<string, string> | null;
  requestedAt: string;
  completedAt: string | null;
  file: { id: string; sizeBytes: number } | null;
}

/** What decides which board- and state-specific exports an institute is offered. */
export interface ExportInstituteProfile {
  affiliations?: ReadonlyArray<{ board: string; affiliationStatus: string }> | null;
  address?: { state: string } | null;
  identifiers?: ReadonlyArray<{ type: string }> | null;
}

const ERROR_KEYS = [
  'EXPORT_GENERATION_FAILED',
  'EXPORT_START_FAILED',
  'EXPORT_TIMED_OUT',
  'EXPORT_TYPE_NOT_AVAILABLE',
  'FILE_TOO_LARGE',
  'INVALID_STATE_TRANSITION',
  'ACADEMIC_YEAR_NOT_FOUND',
  'INSTITUTE_NOT_FOUND',
  'FORBIDDEN',
] as const;
type ErrorKey = (typeof ERROR_KEYS)[number] | 'unknown';

function errorKey(code: string | null): ErrorKey {
  return ERROR_KEYS.find((key) => key === code) ?? 'unknown';
}

function inProgress(status: ExportReportStatus): boolean {
  return status === 'PENDING' || status === 'RUNNING';
}

/** Report types the institute qualifies for: the same rule the API enforces. */
export function availableReportTypes(institute: ExportInstituteProfile): ComplianceReportType[] {
  return eligibleComplianceReportTypes({
    boards: (institute.affiliations ?? [])
      .filter((aff) => aff.affiliationStatus !== 'REVOKED')
      .map((aff) => aff.board),
    state: institute.address?.state ?? null,
    identifierTypes: (institute.identifiers ?? []).map((id) => id.type),
  });
}

export function InstituteExportsTab({
  instituteId,
  institute,
}: {
  instituteId: string;
  institute: ExportInstituteProfile;
}) {
  const t = useTranslations('adminInstitutes.exports');
  const reportTypes = availableReportTypes(institute);

  const years = useQuery<
    { adminListExportAcademicYears: ExportAcademicYear[] },
    { instituteId: string }
  >(ADMIN_LIST_EXPORT_ACADEMIC_YEARS, { variables: { instituteId } });
  const history = useQuery<{ adminListExportReports: ExportReportRow[] }, { instituteId: string }>(
    ADMIN_LIST_EXPORT_REPORTS,
    { variables: { instituteId }, notifyOnNetworkStatusChange: false },
  );
  const reports = history.data?.adminListExportReports ?? [];
  const historyLoading = history.loading && !history.data;
  const anyInProgress = reports.some((report) => inProgress(report.status));
  const { startPolling, stopPolling } = history;

  React.useEffect(() => {
    if (anyInProgress) startPolling(EXPORT_POLL_INTERVAL_MS);
    else stopPolling();
    return () => stopPolling();
  }, [anyInProgress, startPolling, stopPolling]);

  const yearOptions = years.data?.adminListExportAcademicYears ?? [];
  const [chosenYearId, setChosenYearId] = React.useState<string | null>(null);
  const yearId =
    chosenYearId ?? yearOptions.find((year) => year.isActive)?.id ?? yearOptions[0]?.id ?? null;

  const [requestExport] = useMutation<
    { adminExportComplianceReport: { id: string; status: ExportReportStatus } },
    { input: { instituteId: string; reportType: ComplianceReportType; academicYearId: string } }
  >(ADMIN_EXPORT_COMPLIANCE_REPORT);
  const [starting, setStarting] = React.useState<ComplianceReportType | null>(null);

  const generate = async (reportType: ComplianceReportType) => {
    if (!yearId) return;
    setStarting(reportType);
    try {
      await requestExport({
        variables: { input: { instituteId, reportType, academicYearId: yearId } },
      });
      toast.success(t('toast.started'));
    } catch (err) {
      toast.error(t('toast.failed'), {
        description: t(`errors.${errorKey(extractGraphQLErrorCode(err))}`),
      });
    } finally {
      setStarting(null);
      // A refused start still leaves a FAILED row to show.
      await history.refetch();
    }
  };

  return (
    <div className="space-y-6" data-testid={ids.exportsTab}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <YearSelect
          loading={years.loading && !years.data}
          years={yearOptions}
          value={yearId}
          onChange={setChosenYearId}
        />
      </div>

      {!years.loading && yearOptions.length === 0 ? (
        <Empty className="py-8" data-testid={ids.exportsNoYears}>
          <EmptyHeader>
            <EmptyDescription>{t('noAcademicYears')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {reportTypes.map((reportType) => (
            <ExportCard
              key={reportType}
              reportType={reportType}
              latest={
                reports.find(
                  (report) => report.reportType === reportType && report.academicYearId === yearId,
                ) ?? null
              }
              loading={historyLoading}
              canGenerate={yearId !== null && starting === null && !historyLoading}
              starting={starting === reportType}
              onGenerate={() => void generate(reportType)}
            />
          ))}
        </div>
      )}

      <ExportHistory
        reports={reports}
        loading={historyLoading}
        failed={!!history.error && !history.data}
        onRetry={() => void history.refetch()}
      />
    </div>
  );
}

function YearSelect({
  loading,
  years,
  value,
  onChange,
}: {
  loading: boolean;
  years: ExportAcademicYear[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const t = useTranslations('adminInstitutes.exports');
  if (loading) return <Skeleton className="h-9 w-48" />;
  if (years.length === 0) return null;
  return (
    <Field className="w-full sm:w-56">
      <FieldLabel htmlFor="export-academic-year">{t('academicYear')}</FieldLabel>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger id="export-academic-year" data-testid={ids.exportsYearSelect}>
          <SelectValue placeholder={t('academicYearPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {years.map((year) => (
            <SelectItem key={year.id} value={year.id}>
              {year.isActive ? t('activeYear', { label: year.label }) : year.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function ExportCard({
  reportType,
  latest,
  loading,
  canGenerate,
  starting,
  onGenerate,
}: {
  reportType: ComplianceReportType;
  latest: ExportReportRow | null;
  loading: boolean;
  canGenerate: boolean;
  starting: boolean;
  onGenerate: () => void;
}) {
  const t = useTranslations('adminInstitutes.exports');
  const busy = starting || (latest !== null && inProgress(latest.status));

  return (
    <Card data-testid={ids.exportCard(reportType)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet aria-hidden="true" className="size-4 text-muted-foreground" />
          {t(`reportTypes.${reportType}.title`)}
        </CardTitle>
        <CardDescription>{t(`reportTypes.${reportType}.description`)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton
            className="h-5 w-40"
            aria-busy="true"
            data-testid={ids.exportCardLoading(reportType)}
          />
        ) : (
          <ExportState reportType={reportType} latest={latest} />
        )}
        <Can I="manage" a="Export">
          <Button
            size="sm"
            variant={latest ? 'outline' : 'default'}
            disabled={!canGenerate || busy}
            aria-busy={starting}
            title={t('generateHint')}
            onClick={onGenerate}
            data-testid={ids.exportGenerateBtn(reportType)}
          >
            {starting ? <Spinner aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {latest ? t('regenerate') : t('generate')}
          </Button>
        </Can>
      </CardContent>
    </Card>
  );
}

function ExportState({
  reportType,
  latest,
}: {
  reportType: ComplianceReportType;
  latest: ExportReportRow | null;
}) {
  const t = useTranslations('adminInstitutes.exports');
  const { format } = useFormatDate();

  if (!latest) return <p className="text-sm text-muted-foreground">{t('notGenerated')}</p>;

  if (inProgress(latest.status)) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex items-center gap-2 text-sm"
        data-testid={ids.exportProgress(reportType)}
      >
        <Spinner aria-hidden="true" />
        {latest.status === 'PENDING' ? t('queued') : t('running')}
      </div>
    );
  }

  if (latest.status === 'FAILED') {
    return (
      <p
        role="alert"
        className="text-sm text-destructive"
        data-testid={ids.exportError(reportType)}
      >
        {t(`errors.${errorKey(latest.errorCode)}`)}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-sm">
        <p className="font-medium">{t('ready', { count: latest.rowCount ?? 0 })}</p>
        {latest.completedAt && (
          <p className="text-muted-foreground">
            {t('generatedOn', { date: format(new Date(latest.completedAt), 'dd/MM/yyyy HH:mm') })}
          </p>
        )}
      </div>
      {latest.file && (
        <Can I="read" a="Export">
          <FileDownloadButton
            fileId={latest.file.id}
            scope="adminExport"
            label={t('download')}
            testId={ids.exportDownloadBtn(reportType)}
          />
        </Can>
      )}
    </div>
  );
}

const STATUS_VARIANT = {
  PENDING: 'secondary',
  RUNNING: 'secondary',
  COMPLETED: 'default',
  FAILED: 'destructive',
} as const satisfies Record<ExportReportStatus, 'default' | 'secondary' | 'destructive'>;

function ExportHistory({
  reports,
  loading,
  failed,
  onRetry,
}: {
  reports: ExportReportRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('adminInstitutes.exports');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('history.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ExportHistoryBody reports={reports} loading={loading} failed={failed} onRetry={onRetry} />
      </CardContent>
    </Card>
  );
}

function ExportHistoryBody({
  reports,
  loading,
  failed,
  onRetry,
}: {
  reports: ExportReportRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('adminInstitutes.exports');

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" data-testid={ids.exportsHistoryLoading}>
        {['a', 'b', 'c'].map((key) => (
          <Skeleton key={key} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <Empty className="py-8" data-testid={ids.exportsHistoryError}>
        <EmptyHeader>
          <EmptyTitle>{t('history.loadFailed')}</EmptyTitle>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={onRetry} data-testid={ids.exportsHistoryRetry}>
          {t('history.retry')}
        </Button>
      </Empty>
    );
  }

  if (reports.length === 0) {
    return (
      <Empty className="py-8" data-testid={ids.exportsHistoryEmpty}>
        <EmptyHeader>
          <EmptyTitle>{t('history.empty')}</EmptyTitle>
          <EmptyDescription>{t('history.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table data-testid={ids.exportsHistoryTable}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('history.columns.type')}</TableHead>
          <TableHead>{t('history.columns.year')}</TableHead>
          <TableHead>{t('history.columns.requestedAt')}</TableHead>
          <TableHead>{t('history.columns.requestedBy')}</TableHead>
          <TableHead>{t('history.columns.status')}</TableHead>
          <TableHead className="text-end">{t('history.columns.rows')}</TableHead>
          <TableHead className="text-end">{t('history.columns.size')}</TableHead>
          <TableHead>{t('history.columns.download')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.map((report) => (
          <ExportHistoryRow key={report.id} report={report} />
        ))}
      </TableBody>
    </Table>
  );
}

function ExportHistoryRow({ report }: { report: ExportReportRow }) {
  const t = useTranslations('adminInstitutes.exports');
  const { format } = useFormatDate();
  const number = useFormatNumber();
  const resolveI18n = useI18nField();

  const requester = report.requesterFirstName
    ? `${resolveI18n(report.requesterFirstName)} ${
        report.requesterLastName ? resolveI18n(report.requesterLastName) : ''
      }`.trim()
    : '—';
  const size = (bytes: number) =>
    bytes >= 1024 * 1024
      ? t('history.sizeMb', {
          size: number.format(bytes / (1024 * 1024), { maximumFractionDigits: 1 }),
        })
      : t('history.sizeKb', { size: number.format(bytes / 1024, { maximumFractionDigits: 1 }) });

  return (
    <TableRow data-testid={ids.exportsHistoryRow(report.id)}>
      <TableCell className="font-medium">{t(`reportTypes.${report.reportType}.title`)}</TableCell>
      <TableCell>{report.academicYearLabel ?? '—'}</TableCell>
      <TableCell>{format(new Date(report.requestedAt), 'dd/MM/yyyy HH:mm')}</TableCell>
      <TableCell>{requester}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[report.status]}>{t(`statuses.${report.status}`)}</Badge>
        {report.status === 'FAILED' && (
          <p
            className="mt-1 max-w-xs text-xs whitespace-normal text-destructive"
            data-testid={ids.exportsHistoryRowError(report.id)}
          >
            {t(`errors.${errorKey(report.errorCode)}`)}
          </p>
        )}
      </TableCell>
      <TableCell className="text-end">
        {report.rowCount === null ? '—' : number.format(report.rowCount)}
      </TableCell>
      <TableCell className="text-end">{report.file ? size(report.file.sizeBytes) : '—'}</TableCell>
      <TableCell>
        {report.file ? (
          <Can I="read" a="Export">
            <FileDownloadButton
              fileId={report.file.id}
              scope="adminExport"
              label={t('download')}
              testId={ids.exportsHistoryDownloadBtn(report.id)}
            />
          </Can>
        ) : (
          '—'
        )}
      </TableCell>
    </TableRow>
  );
}
