'use client';

import type { FilePurpose } from '@roviq/common-types';
import { Button } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { FileUpload } from '@web/components/file-upload/file-upload';
import { StoredImage, type StoredImageFile } from '@web/components/stored-image/stored-image';
import { Trash2, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

const { instituteSettings: ids } = testIds;

/** Undefined keeps the saved image, null removes it, an id replaces it. */
export type BrandingImageValue = string | null | undefined;

export interface BrandingImageFieldProps {
  /** Short name used in test ids: `logo`, `favicon` or `cover`. */
  name: 'logo' | 'favicon' | 'cover';
  purpose: FilePurpose;
  label: string;
  description: string;
  /** The image saved now, if any. */
  current: StoredImageFile | null | undefined;
  value: BrandingImageValue;
  /** `file` is the picked file when a new image was uploaded. */
  onChange: (value: BrandingImageValue, file?: File) => void;
  onBusyChange: (busy: boolean) => void;
  editable: boolean;
  /** Changes after each save so the upload box starts empty again. */
  round: number;
}

export function BrandingImageField({
  name,
  purpose,
  label,
  description,
  current,
  value,
  onChange,
  onBusyChange,
  editable,
  round,
}: BrandingImageFieldProps) {
  const t = useTranslations('instituteSettings.branding');
  const hasSaved = Boolean(current?.url);

  return (
    <div className="space-y-2" data-testid={ids.brandingImageField(name)}>
      {hasSaved && value !== null && (
        <div className="flex items-center gap-3">
          <StoredImage
            file={current}
            alt={label}
            className={
              name === 'cover'
                ? 'h-16 w-48 rounded border'
                : 'size-16 rounded border bg-muted/30 [&_img]:object-contain'
            }
            testId={ids.brandingImageCurrent(name)}
          />
          {editable && value === undefined && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-rose-700 hover:bg-rose-50"
              title={t('removeFile')}
              data-testid={ids.brandingImageRemoveBtn(name)}
              onClick={() => onChange(null)}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {t('removeFile')}
            </Button>
          )}
        </div>
      )}
      {hasSaved && value === null && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          data-testid={ids.brandingImageRemoveNote(name)}
        >
          <span className="me-auto">{t('removeOnSave', { image: label })}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title={t('undoRemove')}
            data-testid={ids.brandingImageUndoBtn(name)}
            onClick={() => onChange(undefined)}
          >
            <Undo2 aria-hidden="true" className="size-4" />
            {t('undoRemove')}
          </Button>
        </div>
      )}
      {editable && (
        <FileUpload
          key={round}
          name={`branding-${name}`}
          purpose={purpose}
          label={hasSaved ? t('replaceImage', { image: label }) : label}
          description={description}
          onChange={(fileIds, files) => {
            const [fileId] = fileIds;
            if (fileId) onChange(fileId, files[0]);
            // The upload was taken back: fall back to the saved image.
            else if (typeof value === 'string') onChange(undefined);
          }}
          onBusyChange={onBusyChange}
        />
      )}
      {!editable && !hasSaved && (
        <p className="text-sm text-muted-foreground">
          {label}: {t('noImage')}
        </p>
      )}
    </div>
  );
}
