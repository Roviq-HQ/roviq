'use client';

import type { FilePurpose } from '@roviq/common-types';
import { Button, Field, FieldDescription, FieldLabel } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { FileUpload } from '@web/components/file-upload/file-upload';
import { StoredImage, type StoredImageFile } from '@web/components/stored-image/stored-image';
import { useTranslations } from 'next-intl';

const { resellerSettings } = testIds;

/** undefined: keep the stored image. null: remove it. A string: the upload that replaces it. */
export type ImageChange = string | null | undefined;

export interface BrandingImageFieldProps {
  /** Distinguishes the two fields in test ids: "logo" or "favicon". */
  name: 'logo' | 'favicon';
  purpose: FilePurpose;
  label: string;
  description: string;
  current: StoredImageFile | null | undefined;
  change: ImageChange;
  onChange: (change: ImageChange) => void;
  onBusyChange: (busy: boolean) => void;
  /** Read-only roles see the stored image and nothing to change it with. */
  editable: boolean;
  /** Changing it clears the upload list, after a save. */
  resetKey: number;
  imageClassName: string;
}

export function BrandingImageField({
  name,
  purpose,
  label,
  description,
  current,
  change,
  onChange,
  onBusyChange,
  editable,
  resetKey,
  imageClassName,
}: BrandingImageFieldProps) {
  const t = useTranslations('resellerSettings.branding');
  const hasCurrent = Boolean(current?.url);
  const removing = change === null;

  const stored = hasCurrent ? (
    <div className="flex items-center gap-3">
      <StoredImage
        file={current}
        alt={label}
        className={`${imageClassName} rounded border ${removing ? 'opacity-40' : ''}`}
        testId={resellerSettings.brandingCurrentImage(name)}
      />
      {editable &&
        (removing ? (
          <>
            <span className="text-sm text-muted-foreground">{t('imageWillBeRemoved')}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              title={t('keepImage')}
              onClick={() => onChange(undefined)}
              data-testid={resellerSettings.brandingKeepImageBtn(name)}
            >
              {t('keepImage')}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            title={t('removeImage')}
            onClick={() => onChange(null)}
            data-testid={resellerSettings.brandingRemoveImageBtn(name)}
          >
            {t('removeImage')}
          </Button>
        ))}
    </div>
  ) : null;

  if (!editable) {
    return (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        {stored ?? (
          <FieldDescription data-testid={resellerSettings.brandingNoImage(name)}>
            {t('noImage')}
          </FieldDescription>
        )}
      </Field>
    );
  }

  return (
    <div className="space-y-3">
      {stored}
      <FileUpload
        key={resetKey}
        name={`reseller-${name}`}
        purpose={purpose}
        label={hasCurrent ? t('replaceImage', { label }) : label}
        description={description}
        onChange={(fileIds) => onChange(fileIds[0] ?? (removing ? null : undefined))}
        onBusyChange={onBusyChange}
      />
    </div>
  );
}
