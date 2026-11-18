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
  FieldLabel,
  Input,
  Textarea,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { impersonationExchangeUrl, institutePortalOrigin } from './institute-portal-url';

const { impersonation: ids } = testIds;

export const MIN_REASON_LENGTH = 10;
const OTP_PATTERN = /^\d{6}$/;

/** What every start or verify mutation returns: a code, or a request waiting for an OTP. */
export interface ImpersonationStep {
  code?: string | null;
  requiresOtp?: boolean | null;
  sessionId?: string | null;
}

export interface ImpersonateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetName: string;
  instituteName: string;
  start: (reason: string) => Promise<ImpersonationStep>;
  /** Needed where the server can ask for the institute admin's OTP (platform, reseller). */
  verifyOtp?: (requestId: string, otp: string) => Promise<ImpersonationStep>;
}

type Stage = { kind: 'reason' } | { kind: 'otp'; requestId: string };

export function ImpersonateUserDialog({
  open,
  onOpenChange,
  targetName,
  instituteName,
  start,
  verifyOtp,
}: ImpersonateUserDialogProps) {
  const t = useTranslations('impersonation');
  const locale = useLocale();
  const [stage, setStage] = React.useState<Stage>({ kind: 'reason' });
  const [reason, setReason] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) return;
    setStage({ kind: 'reason' });
    setReason('');
    setOtp('');
    setTouched(false);
    setError(null);
  }, [open]);

  const reasonTooShort = reason.trim().length < MIN_REASON_LENGTH;
  const otpInvalid = !OTP_PATTERN.test(otp);

  const errorMessage = (err: unknown) => {
    const code = extractGraphQLErrorCode(err);
    return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
  };

  /**
   * The tab is opened before the request, while the click still counts as a user
   * gesture; opened after an await, popup blockers would stop it.
   */
  const run = async (request: () => Promise<ImpersonationStep>) => {
    setError(null);
    setPending(true);
    const tab = window.open('about:blank', '_blank');
    try {
      const step = await request();
      if (step.code) {
        const url = impersonationExchangeUrl(
          institutePortalOrigin(window.location),
          locale,
          step.code,
        );
        if (tab) {
          tab.opener = null;
          tab.location.replace(url);
        } else {
          window.open(url, '_blank', 'noopener');
        }
        toast.success(t('opened', { name: targetName }));
        onOpenChange(false);
        return;
      }
      tab?.close();
      if (step.requiresOtp && step.sessionId && verifyOtp) {
        setTouched(false);
        setStage({ kind: 'otp', requestId: step.sessionId });
        return;
      }
      setError(t('errors.generic'));
    } catch (err) {
      tab?.close();
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (stage.kind === 'reason') {
      if (reasonTooShort) return;
      void run(() => start(reason.trim()));
      return;
    }
    if (otpInvalid || !verifyOtp) return;
    void run(() => verifyOtp(stage.requestId, otp));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent data-testid={ids.dialog}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title', { name: targetName })}</DialogTitle>
            <DialogDescription>
              {stage.kind === 'reason'
                ? t('description', { name: targetName, institute: instituteName })
                : t('otpDescription', { institute: instituteName })}
            </DialogDescription>
          </DialogHeader>

          {stage.kind === 'reason' ? (
            <Field data-invalid={touched && reasonTooShort}>
              <FieldLabel htmlFor="impersonation-reason">{t('reasonLabel')}</FieldLabel>
              <Textarea
                id="impersonation-reason"
                data-testid={ids.reasonInput}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={touched && reasonTooShort}
                maxLength={500}
                rows={3}
                autoFocus
              />
              <FieldDescription>
                {t('reasonHint', { min: MIN_REASON_LENGTH, count: reason.trim().length })}
              </FieldDescription>
              {touched && reasonTooShort && (
                <FieldError
                  data-testid={ids.reasonError}
                  errors={[{ message: t('reasonTooShort', { min: MIN_REASON_LENGTH }) }]}
                />
              )}
            </Field>
          ) : (
            <Field data-invalid={touched && otpInvalid}>
              <FieldLabel htmlFor="impersonation-otp">{t('otpLabel')}</FieldLabel>
              <Input
                id="impersonation-otp"
                data-testid={ids.otpInput}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-invalid={touched && otpInvalid}
                autoFocus
              />
              {touched && otpInvalid && (
                <FieldError errors={[{ message: t('otpInvalidFormat') }]} />
              )}
            </Field>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid={ids.error}>
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              data-testid={ids.cancelBtn}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending} data-testid={ids.submitBtn}>
              {stage.kind === 'reason' ? t('start') : t('verify')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
