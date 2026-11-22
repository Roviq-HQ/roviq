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
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { StandardSectionSelect } from '@web/components/pickers/standard-section-select';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { useMediaQuery } from '../../../../../../hooks/use-media-query';
import { useChangeStudentClass, useEnrollStudent, useRemoveStudentFromYear } from './use-students';

const { instituteStudents } = testIds;

const REASON_MIN = 3;
const REASON_MAX = 500;

function useErrorMessage() {
  const tError = useTranslations('error');
  return (err: unknown) => {
    const code = extractGraphQLErrorCode(err);
    return code && tError.has(code) ? tError(code) : tError('errorDescription');
  };
}

/** Rule [QIGCL]: Dialog on desktop, bottom Sheet below 1024px. */
function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  testId,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  testId: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const isMobile = useMediaQuery('(max-width: 1024px)');
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto" data-testid={testId}>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-24">{children}</div>
          <SheetFooter className="sticky bottom-0 border-t bg-background pt-4">
            {footer}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlacementFooter({
  onCancel,
  onSubmit,
  disabled,
  loading,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  const t = useTranslations('students');
  return (
    <>
      <Button
        variant="outline"
        onClick={onCancel}
        disabled={loading}
        data-testid={instituteStudents.placementCancelBtn}
      >
        {t('placement.cancel')}
      </Button>
      <Button
        onClick={onSubmit}
        disabled={disabled}
        data-testid={instituteStudents.placementSubmitBtn}
      >
        {loading ? t('placement.saving') : t('placement.submit')}
      </Button>
    </>
  );
}

/** Places a student who has no class in `academicYearId` (calls `enrollStudent`). */
export function EnrolStudentDialog({
  open,
  onOpenChange,
  studentProfileId,
  studentName,
  academicYearId,
  yearLabel,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentProfileId: string;
  studentName: string;
  academicYearId: string;
  yearLabel: string;
  onSuccess?: () => void;
}) {
  const t = useTranslations('students');
  const errorMessage = useErrorMessage();
  const [enrollStudent, { loading }] = useEnrollStudent();
  const [standardId, setStandardId] = React.useState('');
  const [sectionId, setSectionId] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setStandardId('');
      setSectionId('');
    }
  }, [open]);

  const canSubmit = !loading && standardId !== '' && sectionId !== '';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await enrollStudent({
        variables: { input: { studentProfileId, academicYearId, standardId, sectionId } },
      });
      toast.success(t('placement.enrolSuccess', { name: studentName, year: yearLabel }));
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('placement.enrolTitle', { year: yearLabel })}
      description={t('placement.enrolDescription', { name: studentName })}
      testId={instituteStudents.enrolDialog}
      footer={
        <PlacementFooter
          onCancel={() => onOpenChange(false)}
          onSubmit={handleSubmit}
          disabled={!canSubmit}
          loading={loading}
        />
      }
    >
      <StandardSectionSelect
        key={open ? 'open' : 'closed'}
        academicYearId={academicYearId}
        sectionId={sectionId || null}
        onStandardChange={(id) => setStandardId(id ?? '')}
        onSectionChange={(id) => setSectionId(id ?? '')}
        standardTestId={instituteStudents.placementStandardSelect}
        sectionTestId={instituteStudents.placementSectionSelect}
      />
    </ResponsiveDialog>
  );
}

/** Moves a student to another class of the same year (calls `changeStudentClass`). */
export function ChangeClassDialog({
  open,
  onOpenChange,
  studentAcademicId,
  academicYearId,
  yearLabel,
  currentStandardId,
  currentSectionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentAcademicId: string;
  academicYearId: string;
  yearLabel: string;
  currentStandardId: string | null | undefined;
  currentSectionId: string | null | undefined;
}) {
  const t = useTranslations('students');
  const errorMessage = useErrorMessage();
  const [changeStudentClass, { loading }] = useChangeStudentClass();
  const [standardId, setStandardId] = React.useState(currentStandardId ?? '');
  const [sectionId, setSectionId] = React.useState(currentSectionId ?? '');
  const [needsOverride, setNeedsOverride] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setStandardId(currentStandardId ?? '');
      setSectionId(currentSectionId ?? '');
      setNeedsOverride(false);
      setOverrideReason('');
    }
  }, [open, currentStandardId, currentSectionId]);

  const unchanged = standardId === currentStandardId && sectionId === currentSectionId;
  const canSubmit =
    !loading &&
    standardId !== '' &&
    sectionId !== '' &&
    !unchanged &&
    (!needsOverride || overrideReason.trim() !== '');

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await changeStudentClass({
        variables: {
          input: {
            studentAcademicId,
            standardId,
            sectionId,
            overrideReason: needsOverride ? overrideReason.trim() : undefined,
          },
        },
      });
      toast.success(t('placement.changeClassSuccess'));
      onOpenChange(false);
    } catch (err) {
      if (extractGraphQLErrorCode(err) === 'SECTION_CAPACITY_EXCEEDED') setNeedsOverride(true);
      toast.error(errorMessage(err));
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('placement.changeClassTitle')}
      description={t('placement.changeClassDescription', { year: yearLabel })}
      testId={instituteStudents.changeClassDialog}
      footer={
        <PlacementFooter
          onCancel={() => onOpenChange(false)}
          onSubmit={handleSubmit}
          disabled={!canSubmit}
          loading={loading}
        />
      }
    >
      <FieldGroup>
        <StandardSectionSelect
          key={open ? 'open' : 'closed'}
          academicYearId={academicYearId}
          initialStandardId={currentStandardId}
          sectionId={sectionId || null}
          onStandardChange={(id) => setStandardId(id ?? '')}
          onSectionChange={(id) => {
            setSectionId(id ?? '');
            setNeedsOverride(false);
          }}
          standardTestId={instituteStudents.placementStandardSelect}
          sectionTestId={instituteStudents.placementSectionSelect}
        />
        {needsOverride && (
          <Field>
            <FieldLabel htmlFor="placement-override-reason">
              {t('placement.overrideReasonLabel')}
            </FieldLabel>
            <Textarea
              id="placement-override-reason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              maxLength={REASON_MAX}
              data-testid={instituteStudents.placementOverrideReasonInput}
            />
            <FieldDescription>{t('placement.overrideReasonHelp')}</FieldDescription>
          </Field>
        )}
      </FieldGroup>
    </ResponsiveDialog>
  );
}

/** Takes a student out of one year with a recorded reason (calls `removeStudentFromYear`). */
export function RemoveFromYearDialog({
  open,
  onOpenChange,
  studentAcademicId,
  yearLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentAcademicId: string;
  yearLabel: string;
}) {
  const t = useTranslations('students');
  const errorMessage = useErrorMessage();
  const [removeStudentFromYear, { loading }] = useRemoveStudentFromYear();
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  const handleSubmit = async () => {
    setTouched(true);
    if (loading || !reasonValid) return;
    try {
      await removeStudentFromYear({ variables: { studentAcademicId, reason: trimmed } });
      toast.success(t('placement.removeSuccess', { year: yearLabel }));
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('placement.removeTitle', { year: yearLabel })}
      description={t('placement.removeDescription')}
      testId={instituteStudents.removeFromYearDialog}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            data-testid={instituteStudents.removeFromYearCancelBtn}
          >
            {t('placement.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={loading || (touched && !reasonValid)}
            data-testid={instituteStudents.removeFromYearConfirmBtn}
          >
            {loading ? t('placement.removing') : t('placement.removeConfirm')}
          </Button>
        </>
      }
    >
      <Field data-invalid={touched && !reasonValid}>
        <FieldLabel htmlFor="remove-from-year-reason">
          {t('placement.removeReasonLabel')}
        </FieldLabel>
        <Textarea
          id="remove-from-year-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          maxLength={REASON_MAX}
          aria-invalid={touched && !reasonValid}
          data-testid={instituteStudents.removeFromYearReasonInput}
        />
        <FieldDescription>{t('placement.removeReasonHelp')}</FieldDescription>
        {touched && !reasonValid && <FieldError>{t('placement.removeReasonError')}</FieldError>}
      </Field>
    </ResponsiveDialog>
  );
}
