'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import type { PromotionStatus } from '@roviq/graphql/generated';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldLegend,
  FieldSet,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { useMediaQuery } from '../../../../../../hooks/use-media-query';
import { type StudentListNode, useSetPromotionDecisions } from './use-students';

const { instituteStudents } = testIds;

const RESULT_OPTIONS = [
  'PROMOTED',
  'DETAINED',
  'GRADUATED',
  'PENDING',
] as const satisfies readonly PromotionStatus[];
type ResultOption = (typeof RESULT_OPTIONS)[number];

export function YearEndResultDialog({
  open,
  onOpenChange,
  students,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: Pick<StudentListNode, 'id' | 'currentStudentAcademicId'>[];
  onSuccess: () => void;
}) {
  const t = useTranslations('students');
  const tError = useTranslations('error');
  const [setPromotionDecisions, { loading }] = useSetPromotionDecisions();
  const [status, setStatus] = React.useState<ResultOption | null>(null);
  const isMobile = useMediaQuery('(max-width: 1024px)');

  const studentAcademicIds = React.useMemo(
    () => students.flatMap((s) => (s.currentStudentAcademicId ? [s.currentStudentAcademicId] : [])),
    [students],
  );
  const missing = students.length - studentAcademicIds.length;
  const canSubmit = !loading && status !== null && studentAcademicIds.length > 0;

  React.useEffect(() => {
    if (open) setStatus(null);
  }, [open]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const result = await setPromotionDecisions({
        variables: { input: { studentAcademicIds, status } },
      });
      toast.success(
        t('yearEnd.success', {
          count: result.data?.setPromotionDecisions ?? studentAcademicIds.length,
        }),
      );
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      const code = extractGraphQLErrorCode(err);
      toast.error(code && tError.has(code) ? tError(code) : tError('errorDescription'));
    }
  };

  const body = (
    <div className="space-y-4">
      {missing > 0 && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          data-testid={instituteStudents.yearEndMissingRecord}
        >
          {t('yearEnd.missingAcademicRecord', { count: missing })}
        </p>
      )}
      <FieldSet>
        <FieldLegend>{t('yearEnd.resultLabel')}</FieldLegend>
        <div className="grid gap-2" role="radiogroup" aria-label={t('yearEnd.resultLabel')}>
          {RESULT_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              role="radio"
              aria-checked={status === option}
              variant={status === option ? 'default' : 'outline'}
              className="h-auto flex-col items-start gap-0.5 py-2 text-start"
              title={t(`yearEnd.optionHelp.${option}`)}
              onClick={() => setStatus(option)}
              data-testid={instituteStudents.yearEndOption(option)}
            >
              <span className="font-medium">{t(`yearEnd.options.${option}`)}</span>
              <span className="text-xs font-normal opacity-80">
                {t(`yearEnd.optionHelp.${option}`)}
              </span>
            </Button>
          ))}
        </div>
      </FieldSet>
    </div>
  );

  const footer = (
    <>
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={loading}
        data-testid={instituteStudents.yearEndCancelBtn}
      >
        {t('bulk.cancel')}
      </Button>
      <Button
        onClick={handleSubmit}
        disabled={!canSubmit}
        data-testid={instituteStudents.yearEndApplyBtn}
      >
        {loading ? t('bulk.applying') : t('bulk.apply')}
      </Button>
    </>
  );

  const description = t('yearEnd.dialogDescription', { count: studentAcademicIds.length });

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[90vh] overflow-y-auto"
          data-testid={instituteStudents.yearEndDialog}
        >
          <SheetHeader>
            <SheetTitle>{t('yearEnd.dialogTitle')}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-24">{body}</div>
          <SheetFooter className="sticky bottom-0 border-t bg-background pt-4">
            {footer}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid={instituteStudents.yearEndDialog}>
        <DialogHeader>
          <DialogTitle>{t('yearEnd.dialogTitle')}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
