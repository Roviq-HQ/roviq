'use client';

import { USER_DOCUMENT_TYPE_VALUES, type UserDocumentType } from '@roviq/common-types';
import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useFormatDate } from '@roviq/i18n';
import {
  Button,
  Can,
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
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { FileDownloadButton } from '@web/components/file-upload/file-download-button';
import { FileUpload } from '@web/components/file-upload/file-upload';
import { fileUploadErrorKey } from '@web/components/file-upload/use-file-upload';
import { parseISO } from 'date-fns';
import { FileText, Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { isTerminalApplicationStatus } from '../admission-constants';
import {
  type ApplicationDocumentNode,
  type ApplicationNode,
  useAddApplicationDocument,
  useApplicationDocuments,
  useRemoveApplicationDocument,
} from '../use-admission';

const { instituteAdmissionApplications: ids } = testIds;

const MAX_DOCUMENT_FILES = 10;

export interface ApplicationDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: ApplicationNode | null;
  applicantName: string;
}

export function ApplicationDocumentsDialog({
  open,
  onOpenChange,
  application,
  applicantName,
}: ApplicationDocumentsDialogProps) {
  const t = useTranslations('admission.applications.documentsDialog');
  const { data, loading, error, refetch } = useApplicationDocuments(
    open && application ? application.id : null,
  );

  if (!application) return null;
  const documents = data?.listApplicationDocuments ?? [];
  const closed = isTerminalApplicationStatus(application.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        data-testid={ids.documentsDialog}
      >
        <DialogHeader>
          <DialogTitle>{t('title', { name: applicantName })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {error ? (
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TriangleAlert aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle data-testid={ids.documentsLoadError}>{t('loadError')}</EmptyTitle>
            </EmptyHeader>
            <Button
              variant="outline"
              size="sm"
              title={t('retry')}
              data-testid={ids.documentsRetryBtn}
              onClick={() => void refetch()}
            >
              {t('retry')}
            </Button>
          </Empty>
        ) : loading && !data ? (
          <div className="space-y-2" aria-busy="true" data-testid={ids.documentsLoading}>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : documents.length === 0 ? (
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileText aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle data-testid={ids.documentsEmpty}>{t('empty')}</EmptyTitle>
              <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="space-y-2">
            {documents.map((document) => (
              <DocumentRow key={document.id} document={document} closed={closed} />
            ))}
          </ul>
        )}

        {closed ? (
          <p
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
            data-testid={ids.documentsClosedNote}
          >
            {t('closed')}
          </p>
        ) : (
          <Can I="update" a="Application">
            <AddDocumentForm applicationId={application.id} />
          </Can>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-testid={ids.documentsCloseBtn}
            onClick={() => onOpenChange(false)}
          >
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentRow({ document, closed }: { document: ApplicationDocumentNode; closed: boolean }) {
  const t = useTranslations('admission.applications.documentsDialog');
  const tTypes = useTranslations('students.detail.documents.types');
  const { format } = useFormatDate();
  const [confirming, setConfirming] = React.useState(false);
  const [removeDocument, { loading }] = useRemoveApplicationDocument();

  const remove = async () => {
    try {
      await removeDocument({ variables: { id: document.id } });
      toast.success(t('removed'));
    } catch {
      toast.error(t('removeError'));
      setConfirming(false);
    }
  };

  return (
    <li className="space-y-2 rounded-md border p-3" data-testid={ids.documentRow(document.id)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{tTypes(document.type)}</p>
          <p className="text-xs text-muted-foreground">
            {t('addedOn', { date: format(parseISO(document.createdAt), 'dd/MM/yyyy') })}
          </p>
        </div>
        {!closed && !confirming && (
          <Can I="update" a="Application">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-rose-700 hover:bg-rose-50"
              title={t('remove')}
              data-testid={ids.documentRemoveBtn(document.id)}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {t('remove')}
            </Button>
          </Can>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {document.files.map((file, index) => (
          <FileDownloadButton
            key={file.id}
            fileId={file.id}
            scope="institute"
            label={document.files.length > 1 ? t('page', { n: index + 1 }) : t('open')}
            testId={ids.documentPageBtn(file.id)}
          />
        ))}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-rose-50 p-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100">
          <span className="me-auto">{t('removeConfirm')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            title={t('removeNo')}
            data-testid={ids.documentRemoveCancelBtn(document.id)}
            onClick={() => setConfirming(false)}
          >
            {t('removeNo')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={loading}
            aria-busy={loading}
            title={t('removeYes')}
            data-testid={ids.documentRemoveConfirmBtn(document.id)}
            onClick={() => void remove()}
          >
            {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {t('removeYes')}
          </Button>
        </div>
      )}
    </li>
  );
}

function AddDocumentForm({ applicationId }: { applicationId: string }) {
  const t = useTranslations('admission.applications.documentsDialog');
  const tTypes = useTranslations('students.detail.documents.types');
  const tFiles = useTranslations('fileUpload');
  const typeId = React.useId();
  const [type, setType] = React.useState<UserDocumentType>('BIRTH_CERTIFICATE');
  const [fileIds, setFileIds] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  // Bumped after a save so the upload field starts empty for the next document.
  const [round, setRound] = React.useState(0);
  const [addDocument, { loading }] = useAddApplicationDocument();

  const submit = async () => {
    try {
      await addDocument({ variables: { input: { applicationId, type, fileIds } } });
      toast.success(t('added'));
      setFileIds([]);
      setRound((value) => value + 1);
    } catch (err) {
      const code = extractGraphQLErrorCode(err);
      const fileError = fileUploadErrorKey(code);
      toast.error(
        fileError
          ? tFiles(`errors.${fileError}`, { count: MAX_DOCUMENT_FILES })
          : code === 'APPLICATION_CLOSED'
            ? t('closed')
            : t('addError'),
      );
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">{t('addTitle')}</p>
      <Field>
        <FieldLabel htmlFor={typeId}>{t('typeLabel')}</FieldLabel>
        <Select value={type} onValueChange={(value) => setType(value as UserDocumentType)}>
          <SelectTrigger id={typeId} data-testid={ids.documentTypeSelect}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {USER_DOCUMENT_TYPE_VALUES.map((value) => (
              <SelectItem key={value} value={value} data-testid={ids.documentTypeOption(value)}>
                {tTypes(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <FileUpload
        key={round}
        name="application-document"
        purpose="APPLICATION_DOCUMENT"
        label={t('filesLabel')}
        description={t('filesHint', { count: MAX_DOCUMENT_FILES })}
        maxFiles={MAX_DOCUMENT_FILES}
        onChange={(next) => setFileIds(next)}
        onBusyChange={setUploading}
      />
      <Button
        type="button"
        disabled={fileIds.length === 0 || uploading || loading}
        aria-busy={loading}
        title={t('add')}
        data-testid={ids.documentAddBtn}
        onClick={() => void submit()}
      >
        {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        {loading ? t('adding') : t('add')}
      </Button>
    </div>
  );
}
