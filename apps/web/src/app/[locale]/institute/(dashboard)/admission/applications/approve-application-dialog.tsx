'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { admissionErrorKey } from '../admission-errors';
import {
  type ApplicationNode,
  useApproveApplication,
  useSectionsForAdmission,
} from '../use-admission';

const { instituteAdmissionApplications } = testIds;
export interface ApproveApplicationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: ApplicationNode | null;
  onApproved?: (applicationId: string) => void;
}

/**
 * Confirmation dialog for `fee_paid → enrolled`. A section is required: the
 * workflow places the student in it. The parent page tracks the pending
 * state until the applicationStatusChanged subscription fires.
 *
 * Per [PLNIH] significant operations get a consequence dialog, not a soft
 * delete — enrolment is a one-way action.
 */
export function ApproveApplicationDialog({
  open,
  onOpenChange,
  application,
  onApproved,
}: ApproveApplicationDialogProps) {
  const t = useTranslations('admission');
  const resolveI18n = useI18nField();
  const [approve, { loading }] = useApproveApplication();
  const { data: sectionsData, loading: sectionsLoading } = useSectionsForAdmission(
    open ? application?.standardId : null,
  );
  const sections = sectionsData?.sections ?? [];
  const [sectionId, setSectionId] = React.useState('');

  React.useEffect(() => {
    setSectionId(open ? (application?.sectionId ?? '') : '');
  }, [open, application?.sectionId]);

  const handleConfirm = async () => {
    if (!application || !sectionId) return;
    try {
      await approve({ variables: { id: application.id, sectionId } });
      onApproved?.(application.id);
      onOpenChange(false);
    } catch (err) {
      toast.error(t('applications.approveDialog.error'), {
        description: t(`errors.${admissionErrorKey(extractGraphQLErrorCode(err))}`),
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={instituteAdmissionApplications.approveDialog}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('applications.approveDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('applications.approveDialog.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field>
          <FieldLabel htmlFor="approve-section">
            {t('applications.approveDialog.sectionLabel')}
          </FieldLabel>
          <Select value={sectionId} onValueChange={setSectionId} disabled={sectionsLoading}>
            <SelectTrigger
              id="approve-section"
              data-testid={instituteAdmissionApplications.approveSectionSelect}
            >
              <SelectValue placeholder={t('applications.approveDialog.sectionPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section) => (
                <SelectItem
                  key={section.id}
                  value={section.id}
                  data-testid={instituteAdmissionApplications.approveSectionOption(section.id)}
                >
                  {section.capacity == null
                    ? resolveI18n(section.name)
                    : t('applications.approveDialog.sectionOption', {
                        name: resolveI18n(section.name),
                        filled: section.currentStrength,
                        capacity: section.capacity,
                      })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!sectionsLoading && sections.length === 0 && (
            <p
              className="text-sm text-amber-700"
              data-testid={instituteAdmissionApplications.approveNoSections}
            >
              {t('applications.approveDialog.noSections')}
            </p>
          )}
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={loading}
            data-testid={instituteAdmissionApplications.approveCancelBtn}
          >
            {t('applications.approveDialog.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={loading || !sectionId}
            onClick={handleConfirm}
            data-testid={instituteAdmissionApplications.approveConfirmBtn}
          >
            {loading && <Loader2 aria-hidden="true" className="me-1 size-4 animate-spin" />}
            {t('applications.approveDialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { testIds } from '@roviq/ui/testing/testid-registry';
