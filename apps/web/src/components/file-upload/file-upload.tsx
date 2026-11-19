'use client';

import { FILE_CONTENT_TYPE, type FileContentType, type FilePurpose } from '@roviq/common-types';
import { useFormatNumber } from '@roviq/i18n';
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Progress,
} from '@roviq/ui';
import { cn } from '@roviq/ui/lib/utils';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { CircleAlert, CircleCheck, FileText, RotateCcw, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { type UploadItem, useFileUpload } from './use-file-upload';

const { fileUpload: ids } = testIds;

const TYPE_LABEL: { readonly [T in FileContentType]: string } = {
  [FILE_CONTENT_TYPE.PDF]: 'PDF',
  [FILE_CONTENT_TYPE.JPEG]: 'JPG',
  [FILE_CONTENT_TYPE.PNG]: 'PNG',
  [FILE_CONTENT_TYPE.WEBP]: 'WebP',
  [FILE_CONTENT_TYPE.CSV]: 'CSV',
};

const BYTES_PER_MB = 1024 * 1024;

export interface FileUploadProps {
  purpose: FilePurpose;
  /** Field label, naming what to upload, e.g. "Supporting documents". */
  label: string;
  /** Called with the ids of finished uploads whenever the set changes. */
  onChange: (fileIds: string[]) => void;
  /** Called when uploads start or all finish, so the form can block submit meanwhile. */
  onBusyChange?: (busy: boolean) => void;
  /** Extra guidance shown under the format and size line. */
  description?: string;
  /** Validation message from the surrounding form. */
  error?: string;
  /** Most files allowed. Default 1. */
  maxFiles?: number;
  /** Distinguishes several upload fields on one page in test ids. */
  name: string;
}

export function FileUpload({
  purpose,
  label,
  onChange,
  onBusyChange,
  description,
  error,
  maxFiles = 1,
  name,
}: FileUploadProps) {
  const t = useTranslations('fileUpload');
  const { format } = useFormatNumber();
  const { items, add, remove, retry, policy } = useFileUpload(purpose);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inputId = React.useId();
  const [dragging, setDragging] = React.useState(false);
  const [tooMany, setTooMany] = React.useState(false);

  const doneIds = items.flatMap((item) => (item.fileId ? [item.fileId] : []));
  const doneKey = doneIds.join(',');
  const busy = items.some((item) => item.status === 'uploading');

  // Callbacks are read through refs so a parent re-render does not re-fire them.
  const onChangeRef = React.useRef(onChange);
  const onBusyChangeRef = React.useRef(onBusyChange);
  onChangeRef.current = onChange;
  onBusyChangeRef.current = onBusyChange;
  React.useEffect(() => {
    onChangeRef.current(doneKey ? doneKey.split(',') : []);
  }, [doneKey]);
  React.useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);

  const formatSize = (bytes: number) =>
    bytes >= BYTES_PER_MB
      ? format(bytes / BYTES_PER_MB, {
          style: 'unit',
          unit: 'megabyte',
          maximumFractionDigits: 1,
        })
      : format(Math.max(1, Math.round(bytes / 1024)), { style: 'unit', unit: 'kilobyte' });

  const remaining = maxFiles - items.length;
  const accept = (files: File[]) => {
    if (files.length === 0) return;
    setTooMany(files.length > remaining);
    add(files.slice(0, Math.max(remaining, 0)));
  };

  const types = policy.allowedContentTypes.map((type) => TYPE_LABEL[type]).join(', ');
  const hint = t('hint', { types, size: formatSize(policy.maxSizeBytes), count: maxFiles });

  return (
    <Field data-invalid={Boolean(error) || undefined} data-testid={ids.root(name)}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target only; the button inside is the keyboard path */}
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-input',
          remaining <= 0 && 'opacity-60',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(Array.from(event.dataTransfer.files));
        }}
        data-testid={ids.dropzone(name)}
      >
        <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{t('dropHere')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={remaining <= 0}
          title={t('choose')}
          onClick={() => inputRef.current?.click()}
          data-testid={ids.chooseBtn(name)}
        >
          {t('choose')}
        </Button>
        <Input
          ref={inputRef}
          id={inputId}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept={policy.allowedContentTypes.join(',')}
          multiple={maxFiles > 1}
          onChange={(event) => {
            accept(Array.from(event.target.files ?? []));
            // Lets the same file be picked again after it was removed.
            event.target.value = '';
          }}
          data-testid={ids.input(name)}
        />
      </div>
      <FieldDescription>
        {hint}
        {description ? ` ${description}` : null}
      </FieldDescription>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-busy={busy} data-testid={ids.list(name)}>
          {items.map((item) => (
            <FileRow
              key={item.key}
              item={item}
              size={formatSize(item.sizeBytes)}
              onRemove={() => {
                setTooMany(false);
                remove(item.key);
              }}
              onRetry={() => retry(item.key)}
            />
          ))}
        </ul>
      ) : null}

      {tooMany ? (
        <FieldError data-testid={ids.tooMany(name)}>
          {t('errors.TOO_MANY_FILES', { count: maxFiles })}
        </FieldError>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function FileRow({
  item,
  size,
  onRemove,
  onRetry,
}: {
  item: UploadItem;
  size: string;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations('fileUpload');
  // A failed request has no retryable upload when the file itself was refused.
  const canRetry =
    item.errorKey === 'UPLOAD_FAILED' || item.errorKey === 'FILE_UPLOAD_LIMIT_REACHED';

  return (
    <li
      className="flex items-start gap-3 rounded-md border p-3 text-sm"
      data-status={item.status}
      data-testid={ids.item(item.name)}
    >
      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={item.name}>
          {item.name}
        </p>
        <p className="text-xs text-muted-foreground">{size}</p>
        {item.status === 'uploading' ? (
          <Progress
            value={item.progress}
            className="mt-2"
            aria-label={t('uploading', { name: item.name })}
          />
        ) : null}
        {item.status === 'done' ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-3.5" aria-hidden="true" />
            {t('uploaded')}
          </p>
        ) : null}
        {item.status === 'error' && item.errorKey ? (
          <p
            className="mt-1 flex items-center gap-1 text-xs text-destructive"
            role="alert"
            data-testid={ids.itemError(item.name)}
          >
            <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            {t(`errors.${item.errorKey}`, { count: 1 })}
          </p>
        ) : null}
      </div>
      {item.status === 'error' && canRetry ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t('retry')}
          aria-label={t('retryNamed', { name: item.name })}
          onClick={onRetry}
          data-testid={ids.itemRetry(item.name)}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title={item.status === 'uploading' ? t('cancel') : t('remove')}
        aria-label={
          item.status === 'uploading'
            ? t('cancelNamed', { name: item.name })
            : t('removeNamed', { name: item.name })
        }
        onClick={onRemove}
        data-testid={ids.itemRemove(item.name)}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </li>
  );
}
