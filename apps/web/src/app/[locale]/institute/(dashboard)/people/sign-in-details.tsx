'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import type { SignInStatus } from '@roviq/graphql/generated';
import { useFormatDate } from '@roviq/i18n';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Can,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { CheckCircle2, CircleAlert, CircleSlash, Clock, KeyRound, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { useResendGuardianSignInDetails } from './guardians/use-guardians';
import { useResendStaffSignInDetails } from './staff/use-staff';

const { institutePeople } = testIds;

const KNOWN_ERROR_CODES = [
  'SIGN_IN_ALREADY_COMPLETED',
  'SIGN_IN_CONTACT_MISSING',
  'TOO_MANY_REQUESTS',
  'STAFF_NOT_FOUND',
  'GUARDIAN_NOT_FOUND',
] as const;
type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

function isKnownErrorCode(code: string | null): code is KnownErrorCode {
  return KNOWN_ERROR_CODES.some((known) => known === code);
}

const STATUS_ICON = {
  SIGNED_IN: CheckCircle2,
  DETAILS_SENT: Send,
  SEND_FAILED: CircleAlert,
  NOT_SENT_NO_CONTACT: CircleSlash,
  NOT_SENT: Clock,
} as const satisfies Record<SignInStatus, React.ComponentType<{ className?: string }>>;

const STATUS_VARIANT = {
  SIGNED_IN: 'secondary',
  DETAILS_SENT: 'outline',
  SEND_FAILED: 'destructive',
  NOT_SENT_NO_CONTACT: 'outline',
  NOT_SENT: 'outline',
} as const satisfies Record<SignInStatus, 'secondary' | 'outline' | 'destructive'>;

interface SignInStatusBadgeProps {
  /** Staff or guardian profile id, for the testid. */
  profileId: string;
  status: SignInStatus;
  sentAt: string | null | undefined;
}

/** Where a staff member or guardian stands with their first sign-in (ROV-315). */
export function SignInStatusBadge({ profileId, status, sentAt }: SignInStatusBadgeProps) {
  const t = useTranslations('signInDetails');
  const { format } = useFormatDate();
  const Icon = STATUS_ICON[status];
  const label =
    status === 'DETAILS_SENT' && sentAt
      ? t('status.DETAILS_SENT', { date: format(new Date(sentAt), 'dd/MM/yyyy') })
      : t(`status.${status === 'DETAILS_SENT' ? 'DETAILS_SENT_UNDATED' : status}`);
  return (
    <Badge
      variant={STATUS_VARIANT[status]}
      className="inline-flex items-center gap-1"
      data-testid={institutePeople.signInStatus(profileId)}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </Badge>
  );
}

interface ResendSignInDetailsButtonProps {
  kind: 'staff' | 'guardian';
  profileId: string;
  status: SignInStatus;
  /** Shown in the confirmation, so the admin knows whose password is replaced. */
  name: string;
}

/**
 * Sends a new temporary password. Hidden once the person has signed in: the server refuses
 * then, and there is nothing left to send.
 */
export function ResendSignInDetailsButton(props: ResendSignInDetailsButtonProps) {
  const t = useTranslations('signInDetails');
  const [open, setOpen] = React.useState(false);
  if (props.status === 'SIGNED_IN') return null;

  return (
    <Can I="update" a={props.kind === 'staff' ? 'Staff' : 'Guardian'}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 print:hidden"
        onClick={() => setOpen(true)}
        title={t('resend.buttonTitle', { name: props.name })}
        data-testid={institutePeople.resendSignInBtn}
      >
        <KeyRound aria-hidden="true" className="size-4" />
        {t('resend.button')}
      </Button>
      {open ? <ResendDialog {...props} open={open} onOpenChange={setOpen} /> : null}
    </Can>
  );
}

function ResendDialog({
  kind,
  profileId,
  name,
  open,
  onOpenChange,
}: ResendSignInDetailsButtonProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('signInDetails');
  const tError = useTranslations('error');
  const [resendStaff, staffState] = useResendStaffSignInDetails();
  const [resendGuardian, guardianState] = useResendGuardianSignInDetails();
  const sending = staffState.loading || guardianState.loading;

  async function handleResend() {
    try {
      if (kind === 'staff') await resendStaff({ variables: { staffProfileId: profileId } });
      else await resendGuardian({ variables: { guardianProfileId: profileId } });
      toast.success(t('resend.success', { name }));
      onOpenChange(false);
    } catch (err) {
      const code = extractGraphQLErrorCode(err);
      toast.error(t('resend.failed', { name }), {
        description: isKnownErrorCode(code)
          ? t(`resend.errors.${code}`, { name })
          : tError('errorDescription'),
        duration: Number.POSITIVE_INFINITY,
      });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={institutePeople.resendSignInDialog}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('resend.title', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('resend.description', { name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={institutePeople.resendSignInCancelBtn}>
            {t('resend.cancel')}
          </AlertDialogCancel>
          <Button
            type="button"
            onClick={() => void handleResend()}
            disabled={sending}
            data-testid={institutePeople.resendSignInConfirmBtn}
          >
            {sending ? t('resend.sending') : t('resend.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
