'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import type { CropArea } from './prepare-image';

const { fileUpload: ids } = testIds;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export interface CropDialogProps {
  /** The image to crop; null keeps the dialog closed. */
  file: File | null;
  onConfirm: (file: File, area: CropArea) => void;
  onCancel: () => void;
}

/** Square crop with drag, pinch and a zoom slider; arrow keys move the image. */
export function CropDialog({ file, onConfirm, onCancel }: CropDialogProps) {
  const t = useTranslations('fileUpload');
  const zoomId = React.useId();
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(MIN_ZOOM);
  const [area, setArea] = React.useState<CropArea | null>(null);
  const [source, setSource] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file) {
      setSource(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSource(url);
    setCrop({ x: 0, y: 0 });
    setZoom(MIN_ZOOM);
    setArea(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <Dialog open={file !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent data-testid={ids.cropDialog}>
        <DialogHeader>
          <DialogTitle>{t('crop.title')}</DialogTitle>
          <DialogDescription>{t('crop.description')}</DialogDescription>
        </DialogHeader>
        <div className="relative h-72 w-full overflow-hidden rounded-md bg-muted">
          {source ? (
            <Cropper
              image={source}
              crop={crop}
              zoom={zoom}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_: Area, pixels: Area) => setArea(pixels)}
            />
          ) : null}
        </div>
        <Field>
          <FieldLabel htmlFor={zoomId}>{t('crop.zoom')}</FieldLabel>
          <Input
            id={zoomId}
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            data-testid={ids.cropZoom}
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            title={t('crop.cancel')}
            onClick={onCancel}
            data-testid={ids.cropCancelBtn}
          >
            {t('crop.cancel')}
          </Button>
          <Button
            type="button"
            title={t('crop.confirm')}
            disabled={!file || !area}
            onClick={() => (file && area ? onConfirm(file, area) : undefined)}
            data-testid={ids.cropConfirmBtn}
          >
            {t('crop.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
