'use client';

import { Can, PageHeader, useBreadcrumbOverride } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryStates } from 'nuqs';
import * as React from 'react';
import { ImportProgress } from './import-progress';
import { type ImportTarget, ImportWizard } from './import-wizard';

const { instituteStudentImport: ids } = testIds;

// The running import lives in the URL so a refresh or a shared link resumes its progress.
const importParams = {
  workflow: parseAsString,
  academicYearId: parseAsString,
  standardId: parseAsString,
  sectionId: parseAsString,
};

export default function StudentImportPage() {
  const t = useTranslations('studentImport');
  const [params, setParams] = useQueryStates(importParams, { history: 'push' });
  // Remounts the wizard so "Import another file" starts from an empty form.
  const [attempt, setAttempt] = React.useState(0);

  useBreadcrumbOverride({ import: t('title') });

  const started = (workflowId: string, target: ImportTarget) =>
    void setParams({ workflow: workflowId, ...target });
  const restart = () => {
    setAttempt((n) => n + 1);
    void setParams({ workflow: null, academicYearId: null, standardId: null, sectionId: null });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={<span data-testid={ids.title}>{t('title')}</span>}
        description={t('description')}
      />
      <Can I="create" a="Student" passThrough>
        {(allowed: boolean) =>
          !allowed ? (
            <p className="text-muted-foreground" data-testid={ids.accessDenied}>
              {t('accessDenied')}
            </p>
          ) : params.workflow ? (
            <ImportProgress
              workflowId={params.workflow}
              target={{
                academicYearId: params.academicYearId,
                standardId: params.standardId,
                sectionId: params.sectionId,
              }}
              onRestart={restart}
            />
          ) : (
            <ImportWizard key={attempt} onStarted={started} />
          )
        }
      </Can>
    </div>
  );
}
