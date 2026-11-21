'use client';

import { TC_STATE_MACHINE, type TcStatus } from '@roviq/common-types';
import { zodValidator } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldInfoPopover,
  FieldLabel,
  Skeleton,
  useAppForm,
  useBreadcrumbOverride,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  CheckCircle as CheckCircleFilled,
  Clock,
  ExternalLink,
  FileDown,
  Printer,
  QrCode,
  Send,
  XCircle,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { isKnownDepartment, TC_STATUS_CLASS, TC_STATUS_ICON } from '../../tc-status';
import {
  useApproveTC,
  useIssueTC,
  useRejectTC,
  useRequestDuplicateTC,
  useTC,
} from '../../use-certificates';

const { instituteCertificatesTc } = testIds;
function formatDdMmYyyy(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const rejectSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});
type RejectFormValues = z.input<typeof rejectSchema>;

const duplicateSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});
type DuplicateFormValues = z.input<typeof duplicateSchema>;

const REJECT_DEFAULTS: RejectFormValues = { reason: '' };
const DUPLICATE_DEFAULTS: DuplicateFormValues = { reason: '' };

export default function TCDetailPage() {
  const t = useTranslations('certificates');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const { data, loading } = useTC(id);
  const tc = data?.getTCDetails;

  useBreadcrumbOverride(id && tc?.tcSerialNumber ? { [id]: tc.tcSerialNumber } : {});

  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [duplicateOpen, setDuplicateOpen] = React.useState(false);
  const [approveTC, { loading: approving }] = useApproveTC();
  const [issueTC, { loading: issuing }] = useIssueTC();

  const handleApprove = async () => {
    if (!tc) return;
    try {
      await approveTC({ variables: { id: tc.id } });
      toast.success(t('tc.approveSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('tc.approveError'));
    }
  };

  const handleIssue = async () => {
    if (!tc) return;
    try {
      await issueTC({ variables: { id: tc.id } });
      toast.success(t('tc.issueSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('tc.issueError'));
    }
  };

  if (loading && !tc) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!tc) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          {t('actions.back')}
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t('tc.notFound')}
          </CardContent>
        </Card>
      </div>
    );
  }

  const status: TcStatus = tc.status;
  const StatusIcon = TC_STATUS_ICON[status];
  const clearances = tc.clearances ?? [];
  const tcDataEntries = tc.tcData && typeof tc.tcData === 'object' ? Object.entries(tc.tcData) : [];

  return (
    <Can I="read" a="TC" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between print:hidden">
              <Button variant="ghost" onClick={() => router.back()}>
                <ArrowLeft className="size-4" />
                {t('actions.back')}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => window.print()} title={t('actions.print')}>
                  <Printer className="size-4" />
                  {t('actions.print')}
                </Button>
                {tc.pdfUrl && (
                  <Button asChild variant="outline">
                    <a href={tc.pdfUrl} target="_blank" rel="noopener noreferrer">
                      <FileDown className="size-4" />
                      {t('actions.downloadPdf')}
                    </a>
                  </Button>
                )}
                {tc.qrVerificationUrl && (
                  <Button asChild variant="outline">
                    <a href={tc.qrVerificationUrl} target="_blank" rel="noopener noreferrer">
                      <QrCode className="size-4" />
                      {t('actions.verifyQr')}
                      <ExternalLink className="size-3" />
                    </a>
                  </Button>
                )}
              </div>
            </div>

            <div className="print:max-w-none">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight font-mono">
                    {tc.tcSerialNumber}
                  </h1>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={`inline-flex items-center gap-1 ${TC_STATUS_CLASS[status]}`}
                    >
                      <StatusIcon className="size-3.5" />
                      {t(`tcStatuses.${status}`)}
                    </Badge>
                    {tc.isDuplicate && <Badge variant="outline">{t('duplicate')}</Badge>}
                    <span className="text-sm text-muted-foreground">
                      {t('tc.requestedOn', { date: formatDdMmYyyy(tc.createdAt) })}
                    </span>
                  </div>
                </div>
                <Can I="manage" a="TC">
                  <div className="flex flex-wrap items-center gap-2 print:hidden">
                    {TC_STATE_MACHINE.canTransition(status, 'APPROVED') && (
                      <Button onClick={handleApprove} disabled={approving}>
                        <CheckCircleFilled className="size-4" />
                        {approving ? t('tc.approving') : t('tc.approve')}
                      </Button>
                    )}
                    {TC_STATE_MACHINE.canTransition(status, 'CANCELLED') && (
                      <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                        <XCircle className="size-4" />
                        {t('tc.reject')}
                      </Button>
                    )}
                    {TC_STATE_MACHINE.canTransition(status, 'ISSUED') && (
                      <Button onClick={handleIssue} disabled={issuing}>
                        <Send className="size-4" />
                        {issuing ? t('tc.issuing') : t('tc.issue')}
                      </Button>
                    )}
                    {TC_STATE_MACHINE.canTransition(status, 'DUPLICATE_REQUESTED') &&
                      !tc.isDuplicate && (
                        <Button variant="outline" onClick={() => setDuplicateOpen(true)}>
                          <Award className="size-4" />
                          {t('tc.requestDuplicate')}
                        </Button>
                      )}
                  </div>
                </Can>
              </div>

              <div className="mt-4 text-sm">
                <span className="font-medium">{t('tc.reasonLabel')}: </span>
                <span className="text-muted-foreground">{tc.reason}</span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('tc.clearanceTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {clearances.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('tc.noClearances')}</p>
                    ) : (
                      <ul className="space-y-2">
                        {clearances.map(({ department, cleared, notes }) => {
                          const Icon = cleared ? CheckCircle2 : Clock;
                          const color = cleared ? 'text-emerald-600' : 'text-amber-600';
                          return (
                            <li
                              key={department}
                              className="flex items-start justify-between gap-3 rounded border p-2"
                            >
                              <div className="flex items-start gap-2">
                                <Icon className={`mt-0.5 size-4 ${color}`} />
                                <div>
                                  <p className="text-sm font-medium">
                                    {isKnownDepartment(department)
                                      ? t(`tc.departments.${department}`)
                                      : department}
                                  </p>
                                  {notes && (
                                    <p className="text-xs text-muted-foreground">{notes}</p>
                                  )}
                                </div>
                              </div>
                              <span className={`text-xs font-medium ${color}`}>
                                {t(
                                  cleared
                                    ? 'tc.clearanceStatus.cleared'
                                    : 'tc.clearanceStatus.pending',
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('tc.tcDataTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {tcDataEntries.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('tc.noTcData')}</p>
                    ) : (
                      <FieldGroup>
                        {tcDataEntries.map(([key, value]) => (
                          <Field key={key}>
                            <FieldLabel>{key}</FieldLabel>
                            <div className="rounded border bg-muted/30 px-3 py-2 text-sm">
                              {value === null || value === undefined
                                ? '—'
                                : typeof value === 'object'
                                  ? JSON.stringify(value)
                                  : String(value)}
                            </div>
                          </Field>
                        ))}
                      </FieldGroup>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            <RejectTCDialog
              open={rejectOpen}
              onOpenChange={setRejectOpen}
              tcId={tc.id}
              onSuccess={() => {
                /* refetch handled via Apollo cache invalidation */
              }}
            />

            <RequestDuplicateDialog
              open={duplicateOpen}
              onOpenChange={setDuplicateOpen}
              originalTcId={tc.id}
            />
          </div>
        ) : null
      }
    </Can>
  );
}

function RejectTCDialog({
  open,
  onOpenChange,
  tcId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tcId: string;
  onSuccess: () => void;
}) {
  const t = useTranslations('certificates');
  const [rejectTC] = useRejectTC();

  const form = useAppForm({
    defaultValues: REJECT_DEFAULTS,
    validators: { onChange: zodValidator(rejectSchema), onSubmit: zodValidator(rejectSchema) },
    onSubmit: async ({ value }) => {
      const parsed = rejectSchema.parse(value);
      try {
        await rejectTC({ variables: { id: tcId, reason: parsed.reason } });
        toast.success(t('tc.rejectSuccess'));
        onSuccess();
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('tc.rejectError'));
      }
    },
  });

  React.useEffect(() => {
    if (!open) form.reset(REJECT_DEFAULTS);
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tc.rejectDialog.title')}</DialogTitle>
          <DialogDescription>{t('tc.rejectDialog.description')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="space-y-4"
        >
          <form.AppField name="reason">
            {(field) => (
              <field.TextareaField
                label={t('tc.rejectDialog.reasonLabel')}
                placeholder={t('tc.rejectDialog.reasonPlaceholder')}
                rows={4}
                info={
                  <FieldInfoPopover
                    title={t('tc.rejectDialog.fieldHelp.reasonTitle')}
                    data-testid={instituteCertificatesTc.rejectReasonInfo}
                  >
                    <p>{t('tc.rejectDialog.fieldHelp.reasonBody')}</p>
                  </FieldInfoPopover>
                }
              />
            )}
          </form.AppField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton
                variant="destructive"
                submittingLabel={t('tc.rejectDialog.submitting')}
              >
                {t('tc.rejectDialog.submit')}
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RequestDuplicateDialog({
  open,
  onOpenChange,
  originalTcId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalTcId: string;
}) {
  const t = useTranslations('certificates');
  const [requestDuplicate] = useRequestDuplicateTC();

  const form = useAppForm({
    defaultValues: DUPLICATE_DEFAULTS,
    validators: {
      onChange: zodValidator(duplicateSchema),
      onSubmit: zodValidator(duplicateSchema),
    },
    onSubmit: async ({ value }) => {
      const parsed = duplicateSchema.parse(value);
      try {
        await requestDuplicate({
          variables: { input: { originalTcId, reason: parsed.reason } },
        });
        toast.success(t('tc.duplicateSuccess'));
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('tc.duplicateError'));
      }
    },
  });

  React.useEffect(() => {
    if (!open) form.reset(DUPLICATE_DEFAULTS);
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tc.duplicateDialog.title')}</DialogTitle>
          <DialogDescription>{t('tc.duplicateDialog.description')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="space-y-4"
        >
          <form.AppField name="reason">
            {(field) => (
              <field.TextareaField
                label={t('tc.duplicateDialog.reasonLabel')}
                placeholder={t('tc.duplicateDialog.reasonPlaceholder')}
                rows={4}
                info={
                  <FieldInfoPopover
                    title={t('tc.duplicateDialog.fieldHelp.reasonTitle')}
                    data-testid={instituteCertificatesTc.duplicateReasonInfo}
                  >
                    <p>{t('tc.duplicateDialog.fieldHelp.reasonBody')}</p>
                    <p>
                      <em>{t('tc.duplicateDialog.fieldHelp.reasonExamples')}</em>
                    </p>
                  </FieldInfoPopover>
                }
              />
            )}
          </form.AppField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton submittingLabel={t('tc.duplicateDialog.submitting')}>
                {t('tc.duplicateDialog.submit')}
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
