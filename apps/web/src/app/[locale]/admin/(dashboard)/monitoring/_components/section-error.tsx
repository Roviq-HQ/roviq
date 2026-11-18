'use client';

import { Alert, AlertDescription, Button } from '@roviq/ui';
import { AlertCircle, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { monitoringErrorKey } from '../_lib/error-copy';

interface SectionErrorProps {
  error: unknown;
  onRetry: () => void;
  testId: string;
  retryTestId: string;
}

export function SectionError({ error, onRetry, testId, retryTestId }: SectionErrorProps) {
  const t = useTranslations('adminMonitoring');
  return (
    <Alert variant="destructive" data-testid={testId} role="alert">
      <AlertCircle aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{t(monitoringErrorKey(error))}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          title={t('errors.retryTitle')}
          data-testid={retryTestId}
        >
          <RotateCw className="size-4" aria-hidden="true" />
          {t('errors.retry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
