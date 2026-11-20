'use client';

import {
  FILE_CONTENT_TYPE,
  type FileContentType,
  type FilePurpose,
  IMAGE_PICK_MAX_BYTES,
  isImageContentType,
} from '@roviq/common-types';
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
import { CropDialog } from './crop-dialog';
import { prepareImage } from './prepare-image';
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

// A picker filtering on `text/csv` alone hides .csv files on Windows, where they are Excel's type.
function acceptAttribute(types: readonly FileContentType[]): string {
  return types
    .flatMap((type) => (type === FILE_CONTENT_TYPE.CSV ? [type, '.csv'] : [type]))
    .join(',');
}

export interface FileUploadProps {
  purpose: FilePurpose;
  /** Field label, naming what to upload, e.g. "Supporting documents". */
  label: string;
  /** Called with the ids of finished uploads whenever the set changes; `files[i]` is what `fileIds[i]` holds. */
  onChange: (fileIds: string[], files: File[]) => void;
  /** Called when uploads start or all finish, so the form can block submit meanwhile. */
  onBusyChange?: (busy: boolean) => void;
  /** Extra guidance shown under the format and size line. */
  description?: string;
  /** Validation message from the surrounding form. */
  error?: string;
  /** Most files allowed. Default 1. */
  maxFiles?: number;
  /** Ask the user to crop each picked image to a square first (profile pictures). */
  crop?: 'square';
  /** The person the file is about; required by purposes owned by a person (PROFILE_PHOTO). */
  subjectUserId?: string;
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
  crop,
  subjectUserId,
  name,
}: FileUploadProps) {
  const t = useTranslations('fileUpload');
  const { format } = useFormatNumber();
  const { items, add, remove, retry, policy } = useFileUpload(purpose, subjectUserId);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inputId = React.useId();
  const [dragging, setDragging] = React.useState(false);
  const [tooMany, setTooMany] = React.useState(false);
  const [toCrop, setToCrop] = React.useState<File | null>(null);

  const doneKey = items.flatMap((item) => (item.fileId ? [item.fileId] : [])).join(',');
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const busy = items.some((item) => item.status === 'uploading');

  // Callbacks are read through refs so a parent re-render does not re-fire them.
  const onChangeRef = React.useRef(onChange);
  const onBusyChangeRef = React.useRef(onBusyChange);
  onChangeRef.current = onChange;
  onBusyChangeRef.current = onBusyChange;
  React.useEffect(() => {
    const fileIds = doneKey ? doneKey.split(',') : [];
    const files = fileIds.flatMap((id) => {
      const item = itemsRef.current.find((candidate) => candidate.fileId === id);
      return item ? [item.file] : [];
    });
    onChangeRef.current(fileIds, files);
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

  // A refused file holds no slot: the next pick takes its place.
  const failed = items.filter((item) => item.status === 'error');
  const remaining = maxFiles - (items.length - failed.length);
  const accept = (files: File[]) => {
    if (files.length === 0) return;
    setTooMany(files.length > remaining);
    const accepted = files.slice(0, Math.max(remaining, 0));
    if (accepted.length > 0) for (const item of failed) remove(item.key);
    const [first] = accepted;
    // Only a picture the purpose accepts is worth cropping; anything else goes on to be refused.
    const croppable =
      crop && first && isImageContentType(first.type) && first.size <= IMAGE_PICK_MAX_BYTES;
    if (croppable) setToCrop(first);
    else add(accepted);
  };

  const types = policy.allowedContentTypes.map((type) => TYPE_LABEL[type]).join(', ');
  const hint = t('hint', { types, size: formatSize(policy.maxSizeBytes), count: maxFiles });

  return (
    <Field data-invalid={Boolean(error) || undefined} data-testid={ids.root(name)}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target only; the button inside is the keyboard path */}
      <div
        className={cn(
          // `relative` anchors the visually hidden file input inside the drop zone.
          'relative flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
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
          // `size-px` overrides the Input's `w-full`/`h-8`, which otherwise beat `sr-only` and widen the page.
          className="sr-only size-px"
          tabIndex={-1}
          accept={acceptAttribute(policy.allowedContentTypes)}
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
      {crop ? (
        <CropDialog
          file={toCrop}
          onCancel={() => setToCrop(null)}
          onConfirm={(file, area) => {
            setToCrop(null);
            void prepareImage(file, area).then((cropped) => add([cropped]));
          }}
        />
      ) : null}
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
