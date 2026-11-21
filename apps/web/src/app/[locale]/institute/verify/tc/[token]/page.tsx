'use client';

import { gql, useQuery } from '@roviq/graphql';
import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { parseISO } from 'date-fns';
import { BadgeCheck, CircleAlert, Loader2, SearchX } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { VerifyTcQuery, VerifyTcQueryVariables } from './page.generated';

const { tcVerify } = testIds;

const VERIFY_TC = gql`
  query VerifyTc($token: String!) {
    verifyTC(token: $token) {
      serialNumber
      isValid
      studentName
      instituteName
      issuedOn
      isDuplicate
    }
  }
`;

/** Public: opened from the QR code on a printed transfer certificate, without sign-in. */
export default function VerifyTcPage() {
  const t = useTranslations('certificates.verify');
  const { token } = useParams<{ token: string }>();
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();
  const { data, loading, error, refetch } = useQuery<VerifyTcQuery, VerifyTcQueryVariables>(
    VERIFY_TC,
    { variables: { token }, skip: !token },
  );
  const tc = data?.verifyTC;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md" data-testid={tcVerify.card}>
        <CardHeader>
          <CardDescription>{t('title')}</CardDescription>
          {loading && (
            <CardTitle className="flex items-center gap-2" data-testid={tcVerify.loading}>
              <Loader2 aria-hidden="true" className="size-5 animate-spin" />
              {t('checking')}
            </CardTitle>
          )}
          {!loading && error && (
            <CardTitle className="flex items-center gap-2" data-testid={tcVerify.error}>
              <CircleAlert aria-hidden="true" className="size-5 text-destructive" />
              {t('error')}
            </CardTitle>
          )}
          {!loading && !error && !tc && (
            <>
              <CardTitle className="flex items-center gap-2" data-testid={tcVerify.notFound}>
                <SearchX aria-hidden="true" className="size-5 text-muted-foreground" />
                {t('notFound')}
              </CardTitle>
              <CardDescription>{t('notFoundDescription')}</CardDescription>
            </>
          )}
          {tc?.isValid && (
            <>
              <CardTitle className="flex items-center gap-2" data-testid={tcVerify.valid}>
                <BadgeCheck aria-hidden="true" className="size-5 text-emerald-600" />
                {t('valid')}
              </CardTitle>
              <CardDescription>{t('validDescription')}</CardDescription>
            </>
          )}
          {tc && !tc.isValid && (
            <>
              <CardTitle className="flex items-center gap-2" data-testid={tcVerify.invalid}>
                <CircleAlert aria-hidden="true" className="size-5 text-destructive" />
                {t('invalid')}
              </CardTitle>
              <CardDescription>{t('invalidDescription')}</CardDescription>
            </>
          )}
        </CardHeader>
        {!loading && error && (
          <CardContent>
            <Button
              variant="outline"
              onClick={() => refetch()}
              title={t('retry')}
              data-testid={tcVerify.retryBtn}
            >
              {t('retry')}
            </Button>
          </CardContent>
        )}
        {tc && (
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('fields.serial')}</dt>
              <dd className="font-medium" data-testid={tcVerify.serial}>
                {tc.serialNumber}
                {tc.isDuplicate && (
                  <Badge variant="outline" className="ms-2">
                    {t('duplicate')}
                  </Badge>
                )}
              </dd>
              <dt className="text-muted-foreground">{t('fields.student')}</dt>
              <dd className="font-medium">{tc.studentName ?? '—'}</dd>
              <dt className="text-muted-foreground">{t('fields.institute')}</dt>
              <dd className="font-medium">{resolveI18n(tc.instituteName)}</dd>
              <dt className="text-muted-foreground">{t('fields.issuedOn')}</dt>
              <dd className="font-medium">
                {tc.issuedOn ? format(parseISO(tc.issuedOn), 'dd/MM/yyyy') : '—'}
              </dd>
            </dl>
          </CardContent>
        )}
      </Card>
    </main>
  );
}
