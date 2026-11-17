'use client';

import type { AuthScope } from '@roviq/common-types';
import { Button, useAppForm } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Fingerprint, Loader2 } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';
import { useAuth } from './auth-context';
import { presentAuthError } from './auth-error-feedback';
import { type AuthErrorLabels, isPasskeySupported } from './error-utils';

const { authLogin } = testIds;

type LoginFormValues = { username: string; password: string };

export interface LoginFormProps {
  /** Auth scope — determines which login mutation is called. Default: 'institute'. */
  scope?: AuthScope;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  labels?: {
    username?: string;
    password?: string;
    enterUsername?: string;
    enterPassword?: string;
    signIn?: string;
    signingIn?: string;
    signInWithPasskey?: string;
    or?: string;
    usernameRequired?: string;
    passwordRequired?: string;
    loginFailed?: string;
    /** Translated copy per error code / client failure; `loginFailed` covers unknown codes. */
    errors?: AuthErrorLabels;
  };
}

export function LoginForm({ onSuccess, onError, labels }: LoginFormProps) {
  const { login, loginWithPasskey, isLoading } = useAuth();
  const [isPasskeyLoading, setIsPasskeyLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const l = {
    username: labels?.username ?? 'Username',
    password: labels?.password ?? 'Password',
    enterUsername: labels?.enterUsername ?? 'Enter your username',
    enterPassword: labels?.enterPassword ?? 'Enter your password',
    signIn: labels?.signIn ?? 'Sign in',
    signingIn: labels?.signingIn ?? 'Signing in...',
    signInWithPasskey: labels?.signInWithPasskey ?? 'Sign in with passkey',
    or: labels?.or ?? 'or',
    usernameRequired: labels?.usernameRequired ?? 'Username is required',
    passwordRequired: labels?.passwordRequired ?? 'Password is required',
    loginFailed: labels?.loginFailed ?? 'Login failed. Please try again.',
  };
  const errorLabels: AuthErrorLabels = { ...labels?.errors, generic: l.loginFailed };

  const loginSchema = React.useMemo(
    () =>
      z.object({
        username: z.string().min(1, l.usernameRequired),
        password: z.string().min(1, l.passwordRequired),
      }),
    [l.usernameRequired, l.passwordRequired],
  );

  const form = useAppForm({
    defaultValues: { username: '', password: '' } satisfies LoginFormValues,
    validators: { onChange: loginSchema, onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await login(value);
        onSuccess?.();
      } catch (err) {
        presentAuthError(err, {
          labels: errorLabels,
          onInline: setError,
          onRetry: () => void form.handleSubmit(),
        });
        onError?.(err instanceof Error ? err : new Error(l.loginFailed));
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
      onError?.(err instanceof Error ? err : new Error(l.loginFailed));
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid={authLogin.error}
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
        <form.AppField name="username">
          {(field) => (
            <field.TextField
              label={l.username}
              type="text"
              autoComplete="username webauthn"
              placeholder={l.enterUsername}
              disabled={isLoading || isPasskeyLoading}
              testId={authLogin.username}
              errorTestId={authLogin.usernameError}
            />
          )}
        </form.AppField>

        <form.AppField name="password">
          {(field) => (
            <field.TextField
              label={l.password}
              type="password"
              autoComplete="current-password"
              placeholder={l.enterPassword}
              disabled={isLoading || isPasskeyLoading}
              testId={authLogin.password}
              errorTestId={authLogin.passwordError}
            />
          )}
        </form.AppField>

        <form.AppForm>
          <form.SubmitButton
            testId={authLogin.submit}
            disabled={isLoading || isPasskeyLoading}
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
        disabled={isLoading || isPasskeyLoading}
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
