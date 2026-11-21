'use client';

import {
  SOCIAL_CATEGORY_VALUES,
  type SocialCategory,
  TC_STATE_MACHINE,
  type TcStatus,
} from '@roviq/common-types';
import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useFormatDate, zodValidator } from '@roviq/i18n';
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
  useAbility,
  useAppForm,
  useBreadcrumbOverride,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { parseISO } from 'date-fns';
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
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { TcAccessDenied } from '../../tc-access-denied';
import { tcErrorKey } from '../../tc-errors';
import {
  isIsoCalendarDate,
  isKnownDepartment,
  TC_DATA_FIELDS,
  TC_DATE_FIELDS,
  TC_STATUS_CLASS,
  TC_STATUS_ICON,
} from '../../tc-status';
import {
  type TCNode,
  useApproveTC,
  useIssueTC,
  useRejectTC,
  useRequestDuplicateTC,
  useTC,
  useTCs,
} from '../../use-certificates';

const { instituteCertificatesTc } = testIds;

type ConfirmAction = 'approve' | 'issue' | 'issueDuplicate';

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
  const { format } = useFormatDate();
  const tStudents = useTranslations('students');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const canRead = useAbility().can('read', 'TC');
  const { data, loading } = useTC(id, { skip: !canRead });
  const tc = data?.getTCDetails;

  useBreadcrumbOverride(id && tc?.tcSerialNumber ? { [id]: tc.tcSerialNumber } : {});

  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [duplicateOpen, setDuplicateOpen] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction | null>(null);
  const [approveTC, { loading: approving }] = useApproveTC();
  const [issueTC, { loading: issuing }] = useIssueTC();

  const runConfirmed = async () => {
    if (!tc || !confirmAction) return;
    const action = confirmAction;
    try {
      if (action === 'approve') await approveTC({ variables: { id: tc.id } });
      else await issueTC({ variables: { id: tc.id } });
      toast.success(t(`tc.confirm.${action}.success`));
    } catch (err) {
      toast.error(t(`tc.confirm.${action}.error`), {
        description: t(`tc.errors.${tcErrorKey(extractGraphQLErrorCode(err))}`),
      });
    } finally {
      setConfirmAction(null);
    }
  };

  if (!canRead) return <TcAccessDenied />;

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
  const tcData = readTcData(tc.tcData);
  const busy = approving || issuing;

  // The snapshot stores enum values and ISO dates; show them the way the rest of the app does.
  const displayValue = (key: (typeof TC_DATA_FIELDS)[number], value: string | null) => {
    if (!value) return '—';
    if (TC_DATE_FIELDS.has(key) && isIsoCalendarDate(value)) {
      return format(parseISO(value), 'dd/MM/yyyy');
    }
    if (key === 'socialCategory' && isSocialCategory(value)) {
      return tStudents(`socialCategories.${value}`);
    }
    return value;
  };

  return (
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
            <h1 className="text-2xl font-bold tracking-tight font-mono">{tc.tcSerialNumber}</h1>
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
                {t('tc.requestedOn', { date: format(new Date(tc.createdAt), 'dd/MM/yyyy') })}
              </span>
            </div>
            {tc.isDuplicate && tc.originalTcId && <OriginalTcLink originalTcId={tc.originalTcId} />}
          </div>
          <TcActions
            tc={tc}
            approving={approving}
            issuing={issuing}
            onConfirm={setConfirmAction}
            onReject={() => setRejectOpen(true)}
            onRequestDuplicate={() => setDuplicateOpen(true)}
          />
        </div>

        <div className="mt-4 text-sm">
          <span className="font-medium">{t('tc.reasonLabel')}: </span>
          <span className="text-muted-foreground">{tc.reason}</span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* A duplicate skips department clearance, so it has none to show. */}
          {!tc.isDuplicate && (
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
                              {notes && <p className="text-xs text-muted-foreground">{notes}</p>}
                            </div>
                          </div>
                          <span className={`text-xs font-medium ${color}`}>
                            {t(
                              cleared ? 'tc.clearanceStatus.cleared' : 'tc.clearanceStatus.pending',
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('tc.tcDataTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {tcData.fields.length === 0 && !tcData.rejectionReason ? (
                <p className="text-sm text-muted-foreground">{t('tc.noTcData')}</p>
              ) : (
                <FieldGroup>
                  {tcData.rejectionReason && (
                    <Field>
                      <FieldLabel>{t('tc.fields.rejectionReason')}</FieldLabel>
                      <div className="rounded border bg-muted/30 px-3 py-2 text-sm">
                        {tcData.rejectionReason}
                      </div>
                    </Field>
                  )}
                  {tcData.fields.map(([key, value]) => (
                    <Field key={key}>
                      <FieldLabel>{t(`tc.fields.${key}`)}</FieldLabel>
                      <div className="rounded border bg-muted/30 px-3 py-2 text-sm">
                        {displayValue(key, value)}
                      </div>
                    </Field>
                  ))}
                </FieldGroup>
              )}
            </CardContent>
          </Card>
        </div>

        {!tc.isDuplicate && (status === 'ISSUED' || status === 'DUPLICATE_REQUESTED') && (
          <DuplicatesCard originalTcId={tc.id} />
        )}
      </div>

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmAction(null);
        }}
      >
        <AlertDialogContent data-testid={instituteCertificatesTc.confirmDialog}>
          {confirmAction && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t(`tc.confirm.${confirmAction}.title`)}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t(`tc.confirm.${confirmAction}.description`)}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>{t('actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void runConfirmed();
                  }}
                  disabled={busy}
                  data-testid={instituteCertificatesTc.confirmBtn}
                >
                  {t(`tc.confirm.${confirmAction}.confirm`)}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

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
  );
}

/** Keeps the CBSE fields in certificate order; `rejection_reason` is merged in by rejectTC. */
function readTcData(raw: unknown): {
  fields: Array<[(typeof TC_DATA_FIELDS)[number], string | null]>;
  rejectionReason: string | null;
} {
  if (!raw || typeof raw !== 'object') return { fields: [], rejectionReason: null };
  const data = new Map(Object.entries(raw));
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    fields: TC_DATA_FIELDS.filter((key) => data.has(key)).map((key) => [key, text(data.get(key))]),
    rejectionReason: text(data.get('rejection_reason')),
  };
}

function TcActions({
  tc,
  approving,
  issuing,
  onConfirm,
  onReject,
  onRequestDuplicate,
}: {
  tc: TCNode;
  approving: boolean;
  issuing: boolean;
  onConfirm: (action: ConfirmAction) => void;
  onReject: () => void;
  onRequestDuplicate: () => void;
}) {
  const t = useTranslations('certificates');
  const status: TcStatus = tc.status;
  const issueStatus: TcStatus = tc.isDuplicate ? 'DUPLICATE_ISSUED' : 'ISSUED';
  const busy = approving || issuing;
  const issueLabel = tc.isDuplicate ? t('tc.issueDuplicate') : t('tc.issue');
  return (
    <Can I="manage" a="TC">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {TC_STATE_MACHINE.canTransition(status, 'APPROVED') && (
          <Button
            onClick={() => onConfirm('approve')}
            disabled={busy}
            title={t('tc.approve')}
            data-testid={instituteCertificatesTc.approveBtn}
          >
            <CheckCircleFilled className="size-4" />
            {approving ? t('tc.approving') : t('tc.approve')}
          </Button>
        )}
        {TC_STATE_MACHINE.canTransition(status, 'CANCELLED') && (
          <Button
            variant="destructive"
            onClick={onReject}
            disabled={busy}
            title={t('tc.reject')}
            data-testid={instituteCertificatesTc.rejectBtn}
          >
            <XCircle className="size-4" />
            {t('tc.reject')}
          </Button>
        )}
        {TC_STATE_MACHINE.canTransition(status, issueStatus) && (
          <Button
            onClick={() => onConfirm(tc.isDuplicate ? 'issueDuplicate' : 'issue')}
            disabled={busy}
            title={issueLabel}
            data-testid={instituteCertificatesTc.issueBtn}
          >
            <Send className="size-4" />
            {issuing ? t('tc.issuing') : issueLabel}
          </Button>
        )}
        {TC_STATE_MACHINE.canTransition(status, 'DUPLICATE_REQUESTED') && !tc.isDuplicate && (
          <Button
            variant="outline"
            onClick={onRequestDuplicate}
            title={t('tc.requestDuplicate')}
            data-testid={instituteCertificatesTc.requestDuplicateBtn}
          >
            <Award className="size-4" />
            {t('tc.requestDuplicate')}
          </Button>
        )}
      </div>
    </Can>
  );
}

function OriginalTcLink({ originalTcId }: { originalTcId: string }) {
  const t = useTranslations('certificates');
  const locale = useLocale();
  const { data } = useTC(originalTcId);
  const serial = data?.getTCDetails.tcSerialNumber;
  return (
    <p className="mt-2 text-sm print:hidden">
      <Link
        href={`/${locale}/institute/certificates/tc/${originalTcId}`}
        className="text-primary underline-offset-4 hover:underline"
        data-testid={instituteCertificatesTc.originalLink}
      >
        {serial ? t('tc.duplicateOf', { serial }) : t('tc.viewOriginal')}
      </Link>
    </p>
  );
}

function DuplicatesCard({ originalTcId }: { originalTcId: string }) {
  const t = useTranslations('certificates');
  const locale = useLocale();
  const { format } = useFormatDate();
  const { tcs, loading } = useTCs({ originalTcId });
  return (
    <Card className="mt-4" data-testid={instituteCertificatesTc.duplicatesCard}>
      <CardHeader>
        <CardTitle>{t('tc.duplicatesTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && tcs.length === 0 ? (
          <Skeleton className="h-10 w-full" />
        ) : tcs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('tc.noDuplicates')}</p>
        ) : (
          <ul className="space-y-2">
            {tcs.map((dup: TCNode) => {
              const Icon = TC_STATUS_ICON[dup.status];
              return (
                <li
                  key={dup.id}
                  className="flex items-center justify-between gap-3 rounded border p-2"
                >
                  <Link
                    href={`/${locale}/institute/certificates/tc/${dup.id}`}
                    className="font-mono text-sm text-primary underline-offset-4 hover:underline"
                    data-testid={instituteCertificatesTc.duplicateLink(dup.id)}
                  >
                    {dup.tcSerialNumber}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {t('tc.requestedOn', { date: format(new Date(dup.createdAt), 'dd/MM/yyyy') })}
                  </span>
                  <Badge
                    variant="secondary"
                    className={`inline-flex items-center gap-1 ${TC_STATUS_CLASS[dup.status]}`}
                  >
                    <Icon className="size-3.5" />
                    {t(`tcStatuses.${dup.status}`)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
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
        toast.error(t('tc.rejectError'), {
          description: t(`tc.errors.${tcErrorKey(extractGraphQLErrorCode(err))}`),
        });
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
        toast.error(t('tc.duplicateError'), {
          description: t(`tc.errors.${tcErrorKey(extractGraphQLErrorCode(err))}`),
        });
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

function isSocialCategory(value: string): value is SocialCategory {
  return (SOCIAL_CATEGORY_VALUES as readonly string[]).includes(value);
}
