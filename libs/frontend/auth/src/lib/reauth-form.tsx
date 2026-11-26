'use client';

import { useI18nField } from '@roviq/i18n';
import { Button, useAppForm } from '@roviq/ui';
import { Fingerprint, Loader2 } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';
import { type ReAuthOutcome, useAuth } from './auth-context';
import { presentAuthError } from './auth-error-feedback';
import { type AuthErrorLabels, isPasskeySupported } from './error-utils';
import type { MembershipInfo } from './types';

export interface ReAuthFormLabels {
  password?: string;
  enterPassword?: string;
  signIn?: string;
  signingIn?: string;
  signInWithPasskey?: string;
  or?: string;
  passwordRequired?: string;
  loginFailed?: string;
  switchAccount?: string;
  /** Heading over the institutes to pick when the last one is not among the person's any more. */
  chooseInstitute?: string;
  /** Translated copy per error code / client failure; `loginFailed` covers unknown codes. */
  errors?: AuthErrorLabels;
}

const DEFAULT_LABELS: Required<Omit<ReAuthFormLabels, 'errors'>> = {
  password: 'Password',
  enterPassword: 'Enter your password',
  signIn: 'Sign in',
  signingIn: 'Signing in...',
  signInWithPasskey: 'Sign in with passkey',
  or: 'or',
  passwordRequired: 'Password is required',
  loginFailed: 'Login failed. Please try again.',
  switchAccount: 'Switch account',
  chooseInstitute: 'Choose an institute to continue',
};

interface ReAuthFormProps {
  username: string;
  onSuccess?: () => void;
  onSwitchAccount?: () => void;
  labels?: ReAuthFormLabels;
}

export function ReAuthForm({ username, onSuccess, onSwitchAccount, labels }: ReAuthFormProps) {
  const { reAuthenticate, completeReAuthentication } = useAuth();
  const [isPasskeyLoading, setIsPasskeyLoading] = React.useState(false);
  const [choices, setChoices] = React.useState<MembershipInfo[] | null>(null);
  const [choosing, setChoosing] = React.useState<string | null>(null);

  // A person of several institutes is put back into the one they were in, on this page.
  const finish = (outcome: ReAuthOutcome) => {
    if (outcome.kind === 'chooseInstitute') setChoices(outcome.memberships);
    else onSuccess?.();
  };
  const [error, setError] = React.useState<string | null>(null);

  const l = { ...DEFAULT_LABELS, ...labels };
  const errorLabels: AuthErrorLabels = { ...labels?.errors, generic: l.loginFailed };

  const schema = React.useMemo(
    () => z.object({ password: z.string().min(1, l.passwordRequired) }),
    [l.passwordRequired],
  );

  const form = useAppForm({
    defaultValues: { password: '' },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        finish(await reAuthenticate({ username, password: value.password }));
      } catch (err) {
        presentAuthError(err, {
          labels: errorLabels,
          onInline: setError,
          onRetry: () => void form.handleSubmit(),
        });
      }
    },
  });

  const handlePasskeyLogin = async () => {
    setError(null);
    if (!isPasskeySupported()) {
      presentAuthError(new DOMException('WebAuthn unavailable', 'NotSupportedError'), {
        labels: errorLabels,
        onInline: setError,
      });
      return;
    }
    setIsPasskeyLoading(true);
    try {
      finish(await reAuthenticate('passkey'));
    } catch (err) {
      presentAuthError(err, {
        labels: errorLabels,
        onInline: setError,
        onRetry: () => void handlePasskeyLogin(),
      });
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const choose = async (membershipId: string) => {
    setError(null);
    setChoosing(membershipId);
    try {
      await completeReAuthentication(membershipId);
      onSuccess?.();
    } catch (err) {
      presentAuthError(err, { labels: errorLabels, onInline: setError });
    } finally {
      setChoosing(null);
    }
  };

  const initials = username.charAt(0).toUpperCase();

  if (choices) {
    return (
      <InstituteChoices
        choices={choices}
        heading={l.chooseInstitute}
        error={error}
        choosing={choosing}
        onChoose={(membershipId) => void choose(membershipId)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {initials}
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{username}</span>
        {onSwitchAccount && (
          <button
            type="button"
            onClick={onSwitchAccount}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {l.switchAccount}
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        className="space-y-4"
      >
        <form.AppField name="password">
          {(field) => (
            <field.TextField
              label={l.password}
              type="password"
              autoComplete="current-password"
              placeholder={l.enterPassword}
              disabled={isPasskeyLoading}
            />
          )}
        </form.AppField>

        <form.AppForm>
          <form.SubmitButton
            disabled={isPasskeyLoading}
            submittingLabel={l.signingIn}
            className="w-full"
          >
            {l.signIn}
          </form.SubmitButton>
        </form.AppForm>
      </form>

      <div className="relative flex items-center">
        <div className="flex-1 border-t border-border" />
        <span className="text-muted-foreground px-3 text-xs uppercase tracking-wide">{l.or}</span>
        <div className="flex-1 border-t border-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={isPasskeyLoading}
        className="w-full gap-2.5"
        onClick={handlePasskeyLogin}
      >
        {isPasskeyLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Fingerprint className="size-4" />
        )}
        {isPasskeyLoading ? l.signingIn : l.signInWithPasskey}
      </Button>
    </div>
  );
}

function InstituteChoices({
  choices,
  heading,
  error,
  choosing,
  onChoose,
}: {
  choices: MembershipInfo[];
  heading: string;
  error: string | null;
  choosing: string | null;
  onChoose: (membershipId: string) => void;
}) {
  const ti = useI18nField();
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{heading}</p>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <div className="space-y-2">
        {choices.map((m) => (
          <Button
            key={m.membershipId}
            type="button"
            variant="outline"
            className="w-full justify-start"
            disabled={choosing !== null}
            onClick={() => onChoose(m.membershipId)}
            data-institute-name={ti(m.instituteName)}
          >
            {choosing === m.membershipId && <Loader2 className="size-4 animate-spin" />}
            {ti(m.instituteName)}
          </Button>
        ))}
      </div>
    </div>
  );
}
