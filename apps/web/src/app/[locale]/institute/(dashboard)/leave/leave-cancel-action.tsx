'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Can,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { CalendarOff, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { useStudents } from '../people/students/use-students';
import {
  type ApplicantFacts,
  applicantFactsByMembership,
  leaveSubject,
  useLeaveRulesNeedApplicant,
} from './leave-abilities';
import { leaveActionErrorKey } from './leave-errors';
import { type LeaveRecord, useCancelLeave } from './use-leave';

const { instituteLeave } = testIds;

export interface LeaveCancelActionProps {
  leave: Pick<LeaveRecord, 'id' | 'userId' | 'status'>;
  /** Null for staff applicants or when the student is not in the loaded list. */
  facts: ApplicantFacts | null;
  /** `icon` for table rows, `button` for the detail header. */
  variant: 'icon' | 'button';
  onDone?: () => Promise<unknown>;
}

/**
 * Whoever may decide THIS leave gets Cancel on it while pending or approved. Anyone else gets
 * Withdraw, behind a confirmation, when their `withdraw` rules match it.
 */
export function LeaveCancelAction({ leave, facts, variant, onDone }: LeaveCancelActionProps) {
  const t = useTranslations('leave');
  const { cancel, loading } = useCancelLeave();
  const [confirming, setConfirming] = React.useState(false);
  const target = React.useMemo(
    () => leaveSubject({ userId: leave.userId, status: leave.status }, facts),
    [leave.userId, leave.status, facts],
  );

  async function run(done: 'cancelled' | 'withdrawn'): Promise<void> {
    try {
      await cancel(leave.id);
      toast.success(t(`toasts.${done}`));
      setConfirming(false);
      await onDone?.();
    } catch (err) {
      setConfirming(false);
      toast.error(t(`errors.action.${leaveActionErrorKey(extractGraphQLErrorCode(err))}`));
    }
  }

  const cancellable = leave.status === 'PENDING' || leave.status === 'APPROVED';

  return (
    <Can I="update" this={target} passThrough>
      {(isApprover: boolean) =>
        isApprover ? (
          cancellable ? (
            <ActionButton
              variant={variant}
              kind="cancel"
              busy={loading}
              testId={
                variant === 'icon'
                  ? instituteLeave.rowCancelBtn(leave.id)
                  : instituteLeave.detailCancelBtn
              }
              onClick={() => void run('cancelled')}
            />
          ) : null
        ) : leave.status === 'PENDING' ? (
          <Can I="withdraw" this={target}>
            <ActionButton
              variant={variant}
              kind="withdraw"
              busy={loading}
              testId={
                variant === 'icon'
                  ? instituteLeave.rowWithdrawBtn(leave.id)
                  : instituteLeave.detailWithdrawBtn
              }
              onClick={() => setConfirming(true)}
            />
            <AlertDialog
              open={confirming}
              onOpenChange={(open) => {
                if (!open && !loading) setConfirming(false);
              }}
            >
              <AlertDialogContent data-testid={instituteLeave.withdrawDialog}>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('withdraw.title')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('withdraw.description')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    disabled={loading}
                    data-testid={instituteLeave.withdrawDismissBtn}
                  >
                    {t('withdraw.keep')}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={loading}
                    onClick={(event) => {
                      // Keep the dialog open until the mutation settles.
                      event.preventDefault();
                      void run('withdrawn');
                    }}
                    data-testid={instituteLeave.withdrawConfirmBtn}
                  >
                    {loading ? t('actions.withdrawing') : t('actions.withdraw')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Can>
        ) : null
      }
    </Can>
  );
}

/**
 * Hands `children` the applicant's student facts, loading the student list only when the
 * caller's decide or withdraw rules need them (guardians, class teachers).
 */
export function WithApplicantFacts({
  userId,
  children,
}: {
  userId: string;
  children: (facts: ApplicantFacts | null) => React.ReactNode;
}) {
  const needsFacts = useLeaveRulesNeedApplicant();
  return needsFacts ? (
    <LoadApplicantFacts userId={userId}>{children}</LoadApplicantFacts>
  ) : (
    children(null)
  );
}

function LoadApplicantFacts({
  userId,
  children,
}: {
  userId: string;
  children: (facts: ApplicantFacts | null) => React.ReactNode;
}) {
  // Same window as the list page, so both read one cached result.
  const { students } = useStudents({ first: 200 });
  const facts = React.useMemo(
    () => applicantFactsByMembership(students).get(userId) ?? null,
    [students, userId],
  );
  return children(facts);
}

function ActionButton({
  variant,
  kind,
  busy,
  testId,
  onClick,
}: {
  variant: 'icon' | 'button';
  kind: 'cancel' | 'withdraw';
  busy: boolean;
  testId: string;
  onClick: () => void;
}) {
  const t = useTranslations('leave');
  const label = t(`actions.${kind}`);
  const Icon = kind === 'cancel' ? CalendarOff : Undo2;

  if (variant === 'icon') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="size-8 p-0 text-slate-600 hover:text-slate-700"
        onClick={onClick}
        disabled={busy}
        title={label}
        aria-label={label}
        data-testid={testId}
      >
        <Icon className="size-4" aria-hidden="true" />
      </Button>
    );
  }

  const busyLabel = kind === 'cancel' ? t('actions.cancelling') : t('actions.withdrawing');
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2 text-slate-600"
      onClick={onClick}
      disabled={busy}
      title={label}
      data-testid={testId}
    >
      <Icon className="size-4" aria-hidden="true" />
      {busy ? busyLabel : label}
    </Button>
  );
}
