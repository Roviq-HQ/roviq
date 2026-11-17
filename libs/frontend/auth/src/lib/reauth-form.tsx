'use client';

import { Button, useAppForm } from '@roviq/ui';
import { Fingerprint, Loader2 } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';
import { useAuth } from './auth-context';
import { presentAuthError } from './auth-error-feedback';
import { type AuthErrorLabels, isPasskeySupported } from './error-utils';

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
};

interface ReAuthFormProps {
  username: string;
  onSuccess?: () => void;
  onSwitchAccount?: () => void;
  labels?: ReAuthFormLabels;
}

export function ReAuthForm({ username, onSuccess, onSwitchAccount, labels }: ReAuthFormProps) {
  const { login, loginWithPasskey } = useAuth();
  const [isPasskeyLoading, setIsPasskeyLoading] = React.useState(false);
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
        await login({ username, password: value.password });
        onSuccess?.();
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
      await loginWithPasskey();
      onSuccess?.();
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

  const initials = username.charAt(0).toUpperCase();

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
