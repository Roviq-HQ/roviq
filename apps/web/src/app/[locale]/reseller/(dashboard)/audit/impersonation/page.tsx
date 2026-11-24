'use client';

import { useI18nField } from '@roviq/i18n';
import {
  Can,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useAbility,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  type ImpersonationSessionRow,
  ImpersonationSessionsTable,
} from '@web/components/impersonation/impersonation-sessions-table';
import { ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { useResellerInstitutes } from '../../institutes/use-reseller-institutes';
import {
  useResellerImpersonationSessions,
  useTerminateImpersonationSession,
} from './use-reseller-impersonation-sessions';

const { resellerImpersonation } = testIds;

export default function ResellerImpersonationSessionsPage() {
  const t = useTranslations('impersonationSessions');
  // A role without the ability sends no query.
  if (!useAbility().can('read', 'AuditLog')) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">{t('accessDenied')}</p>
      </div>
    );
  }
  return <ResellerImpersonationSessionsContent />;
}

function ResellerImpersonationSessionsContent() {
  const t = useTranslations('impersonationSessions');
  const resolveI18n = useI18nField();

  const [instituteFilter, setInstituteFilter] = React.useState<string>('all');

  const { sessions, loading, refetch } = useResellerImpersonationSessions({ first: 50 });
  const { institutes } = useResellerInstitutes();
  const [terminate] = useTerminateImpersonationSession();

  const visibleSessions = React.useMemo(
    () =>
      instituteFilter === 'all'
        ? sessions
        : sessions.filter((s) => s.targetTenantId === instituteFilter),
    [sessions, instituteFilter],
  );

  const handleTerminate = async (session: ImpersonationSessionRow) => {
    try {
      await terminate({ variables: { sessionId: session.id } });
      toast.success(t('terminateSuccess'));
      await refetch();
    } catch (err) {
      toast.error(t('terminateError'));
      throw err;
    }
  };

  return (
    <div className="space-y-4" data-testid={resellerImpersonation.page}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <Can I="read" a="AuditLog" passThrough>
        {(allowed: boolean) =>
          allowed ? (
            <>
              <div className="flex items-center gap-2">
                <Select value={instituteFilter} onValueChange={setInstituteFilter}>
                  <SelectTrigger
                    className="w-[260px]"
                    aria-label={t('instituteFilter')}
                    data-testid={resellerImpersonation.instituteFilter}
                  >
                    <SelectValue placeholder={t('instituteFilter')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('allInstitutes')}</SelectItem>
                    {institutes.map((inst) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {resolveI18n(inst.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {visibleSessions.length === 0 && !loading ? (
                <Empty className="py-12" data-testid={resellerImpersonation.empty}>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ShieldOff />
                    </EmptyMedia>
                    <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
                    <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Can I="impersonate" a="User" passThrough>
                  {(canTerminate: boolean) => (
                    <ImpersonationSessionsTable
                      sessions={visibleSessions}
                      ids={resellerImpersonation}
                      impersonatorLabel={t('columns.impersonator')}
                      onTerminate={canTerminate ? handleTerminate : undefined}
                      terminateDescription={() => t('terminateConfirmDescription')}
                    />
                  )}
                </Can>
              )}
            </>
          ) : (
            <div className="flex h-[50vh] items-center justify-center">
              <p className="text-muted-foreground">{t('accessDenied')}</p>
            </div>
          )
        }
      </Can>
    </div>
  );
}
