'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { AlertTriangle, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type AcademicYear,
  type RolloverPreview,
  useAcademicYearRolloverPreview,
  useActivateAcademicYear,
} from './use-academic-years';

const { instituteAcademicYears } = testIds;

const PREVIEW_LINES = [
  'movingUp',
  'staying',
  'completing',
  'notCarried',
  'alreadyPlaced',
] as const satisfies readonly (keyof RolloverPreview)[];

export function ActivateYearDialog({ year }: { year: Pick<AcademicYear, 'id' | 'label'> }) {
  const t = useTranslations('academicYears');
  const tError = useTranslations('error');
  const { activateYear, loading } = useActivateAcademicYear();
  const [open, setOpen] = useState(false);
  const { preview, loading: previewLoading } = useAcademicYearRolloverPreview(
    open ? year.id : null,
  );

  const handleActivate = async () => {
    try {
      await activateYear(year.id);
      toast.success(t('activated', { year: year.label }));
      setOpen(false);
    } catch (err) {
      const code = extractGraphQLErrorCode(err);
      toast.error(code && tError.has(code) ? tError(code) : tError('errorDescription'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="default"
        size="sm"
        className="gap-1.5"
        title={t('activate')}
        onClick={() => setOpen(true)}
        data-testid={instituteAcademicYears.activateBtn(year.id)}
      >
        <Zap className="size-3.5" aria-hidden="true" />
        {t('activate')}
      </Button>
      <DialogContent data-testid={instituteAcademicYears.activateDialog}>
        <DialogHeader>
          <DialogTitle>{t('activateTitle')}</DialogTitle>
          <DialogDescription>{t('activateConfirm', { year: year.label })}</DialogDescription>
        </DialogHeader>
        <section
          aria-label={t('rolloverPreview.title')}
          aria-busy={previewLoading}
          className="space-y-2 text-sm"
          data-testid={instituteAcademicYears.activatePreview}
        >
          <h3 className="font-medium">{t('rolloverPreview.title')}</h3>
          {previewLoading || !preview ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <RolloverPreviewLines preview={preview} />
          )}
        </section>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            data-testid={instituteAcademicYears.activateCancelBtn}
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleActivate}
            disabled={loading}
            data-testid={instituteAcademicYears.activateConfirmBtn}
          >
            {loading ? t('activating') : t('activate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RolloverPreviewLines({ preview }: { preview: RolloverPreview }) {
  const t = useTranslations('academicYears');
  const lines = PREVIEW_LINES.filter((key) => preview[key] > 0);
  if (lines.length === 0 && preview.noClassInNewYear === 0) {
    return <p className="text-muted-foreground">{t('rolloverPreview.none')}</p>;
  }
  return (
    <>
      {lines.length > 0 && (
        <ul className="list-disc space-y-1 ps-5">
          {lines.map((key) => (
            <li key={key} data-testid={instituteAcademicYears.activatePreviewLine(key)}>
              {t(`rolloverPreview.${key}`, { count: preview[key] })}
            </li>
          ))}
        </ul>
      )}
      {preview.noClassInNewYear > 0 && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          data-testid={instituteAcademicYears.activatePreviewWarning}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('rolloverPreview.noClassInNewYear', { count: preview.noClassInNewYear })}
        </p>
      )}
    </>
  );
}
