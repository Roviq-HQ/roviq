'use client';

import { useAuth } from '@roviq/auth';
import { ErrorCode } from '@roviq/common-types';
import { extractGraphQLErrorCode, gql, useMutation, useQuery } from '@roviq/graphql';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { BadgeCheck, CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type {
  MyEmailVerificationQuery,
  RequestEmailVerificationMutation,
  VerifyEmailMutation,
  VerifyEmailMutationVariables,
} from './email-verification.generated';

const { accountEmail } = testIds;

const MY_EMAIL_VERIFICATION = gql`
  query MyEmailVerification {
    myEmailVerification {
      email
      isVerified
    }
  }
`;

const REQUEST_EMAIL_VERIFICATION = gql`
  mutation RequestEmailVerification {
    requestEmailVerification
  }
`;

const VERIFY_EMAIL = gql`
  mutation VerifyEmail($code: String!) {
    verifyEmail(code: $code)
  }
`;

const CODE_SHAPE = /^\d{6}$/;

function errorKey(code: string | null): 'codeInvalid' | 'tooSoon' | 'generic' {
  if (code === ErrorCode.EMAIL_VERIFICATION_CODE_INVALID) return 'codeInvalid';
  if (code === ErrorCode.EMAIL_VERIFICATION_TOO_SOON) return 'tooSoon';
  return 'generic';
}

/**
 * Lets a user prove they read their account's email with a code sent only to that address.
 * Until then nobody but the person who created the account can give it a role by email.
 */
export function EmailVerification() {
  const t = useTranslations('account.emailVerification');
  const { isImpersonated } = useAuth();
  const { data, loading, error, refetch } =
    useQuery<MyEmailVerificationQuery>(MY_EMAIL_VERIFICATION);
  const [requestCode, { loading: sending }] = useMutation<RequestEmailVerificationMutation>(
    REQUEST_EMAIL_VERIFICATION,
  );
  const [verify, { loading: verifying }] = useMutation<
    VerifyEmailMutation,
    VerifyEmailMutationVariables
  >(VERIFY_EMAIL);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const state = data?.myEmailVerification;

  async function send() {
    try {
      await requestCode();
      setCodeSent(true);
      setCode('');
      setCodeError(null);
      toast.success(t('codeSent'));
    } catch (err) {
      const key = errorKey(extractGraphQLErrorCode(err));
      // A code is already on its way, so the field to enter it must be there.
      if (key === 'tooSoon') setCodeSent(true);
      toast.error(t(`errors.${key}`));
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!CODE_SHAPE.test(code)) {
      setCodeError(t('errors.codeShape'));
      return;
    }
    try {
      await verify({ variables: { code } });
      toast.success(t('verified'));
      setCodeSent(false);
      setCode('');
      await refetch();
    } catch (err) {
      setCodeError(t(`errors.${errorKey(extractGraphQLErrorCode(err))}`));
    }
  }

  return (
    <Card data-testid={accountEmail.card}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <Skeleton className="h-9 w-64" data-testid={accountEmail.loading} />}
        {!loading && error && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">{t('errors.loadFailed')}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              title={t('retry')}
              data-testid={accountEmail.retryBtn}
            >
              {t('retry')}
            </Button>
          </div>
        )}
        {state && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium" data-testid={accountEmail.address}>
              {state.email}
            </span>
            {state.isVerified ? (
              <Badge variant="outline" className="gap-1" data-testid={accountEmail.verifiedBadge}>
                <BadgeCheck aria-hidden="true" className="size-3.5 text-emerald-600" />
                {t('statusVerified')}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1" data-testid={accountEmail.unverifiedBadge}>
                <CircleAlert aria-hidden="true" className="size-3.5 text-amber-600" />
                {t('statusUnverified')}
              </Badge>
            )}
          </div>
        )}
        {state && !state.isVerified && !isImpersonated && (
          <>
            <p className="text-sm text-muted-foreground">{t('whyVerify')}</p>
            {!codeSent && (
              <Button
                onClick={send}
                disabled={sending}
                title={t('sendCode')}
                data-testid={accountEmail.sendBtn}
              >
                {sending ? t('sending') : t('sendCode')}
              </Button>
            )}
            {codeSent && (
              <form onSubmit={submit} className="space-y-3" noValidate>
                <Field data-invalid={codeError ? true : undefined}>
                  <FieldLabel htmlFor="account-email-code">{t('codeLabel')}</FieldLabel>
                  <Input
                    id="account-email-code"
                    className="max-w-40 tracking-widest"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, ''));
                      setCodeError(null);
                    }}
                    aria-invalid={codeError ? true : undefined}
                    data-testid={accountEmail.codeInput}
                  />
                  <FieldDescription>{t('codeHelp', { email: state.email })}</FieldDescription>
                  {codeError && (
                    <FieldError data-testid={accountEmail.codeError}>{codeError}</FieldError>
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={verifying}
                    title={t('verify')}
                    data-testid={accountEmail.verifyBtn}
                  >
                    {verifying ? t('verifying') : t('verify')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={send}
                    disabled={sending}
                    title={t('sendAgain')}
                    data-testid={accountEmail.resendBtn}
                  >
                    {t('sendAgain')}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
