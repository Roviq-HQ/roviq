'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import {
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
  Skeleton,
  useAbility,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  type ImpersonationSessionRow,
  ImpersonationSessionsTable,
} from '@web/components/impersonation/impersonation-sessions-table';
import { ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { toast } from 'sonner';
import {
  useAdminEndImpersonation,
  useAdminImpersonationSessions,
} from './use-admin-impersonation-sessions';

const { adminImpersonationSessions: ids } = testIds;

const SHOW_VALUES = ['active', 'all'] as const;

export default function AdminImpersonationSessionsPage() {
  const t = useTranslations('impersonationSessions');
  const ability = useAbility();
  const canRead = ability.can('read', 'AuditLog');
  const canTerminate = ability.can('impersonate', 'User');
  const [show, setShow] = useQueryState(
    'show',
    parseAsStringLiteral(SHOW_VALUES).withDefault('active'),
  );
  const { sessions, loading, error, refetch } = useAdminImpersonationSessions(
    show === 'active',
    canRead,
  );
  const [endSession] = useAdminEndImpersonation();

  const terminate = async (session: ImpersonationSessionRow) => {
    try {
      await endSession({ variables: { sessionId: session.id } });
      toast.success(t('terminateSuccess'));
    } catch (err) {
      const code = extractGraphQLErrorCode(err);
      // Someone else, or the expiry sweep, got there first: the list is what is stale.
      if (code === 'IMPERSONATION_SESSION_INVALID') {
        toast.info(t('admin.terminateGone'));
      } else {
        toast.error(code === 'FORBIDDEN' ? t('admin.terminateForbidden') : t('terminateError'));
        throw err;
      }
    } finally {
      await refetch();
    }
  };

  return (
    <div className="space-y-4" data-testid={ids.page}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid={ids.title}>
            {t('admin.title')}
          </h1>
          <p className="text-muted-foreground">{t('admin.description')}</p>
        </div>
        {canRead && (
          <Select
            value={show}
            onValueChange={(value) => void setShow(value === 'all' ? 'all' : 'active')}
          >
            <SelectTrigger
              className="w-[180px]"
              aria-label={t('admin.show')}
              data-testid={ids.showFilter}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t('admin.showActive')}</SelectItem>
              <SelectItem value="all">{t('admin.showAll')}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {canRead ? (
        <SessionsBody
          sessions={sessions}
          loading={loading}
          failed={Boolean(error)}
          activeOnly={show === 'active'}
          onTerminate={canTerminate ? terminate : undefined}
        />
      ) : (
        <p className="py-12 text-center text-muted-foreground" data-testid={ids.accessDenied}>
          {t('accessDenied')}
        </p>
      )}
    </div>
  );
}

function SessionsBody({
  sessions,
  loading,
  failed,
  activeOnly,
  onTerminate,
}: {
  sessions: ImpersonationSessionRow[];
  loading: boolean;
  failed: boolean;
  activeOnly: boolean;
  onTerminate?: (session: ImpersonationSessionRow) => Promise<void>;
}) {
  const t = useTranslations('impersonationSessions');

  if (sessions.length > 0) {
    return (
      <ImpersonationSessionsTable
        sessions={sessions}
        ids={ids}
        showScope
        impersonatorLabel={t('columns.impersonatorAny')}
        onTerminate={onTerminate}
        terminateDescription={(session) =>
          t('admin.terminateConfirmDescription', {
            impersonator: session.impersonatorName ?? '—',
            target: session.targetUserName ?? '—',
          })
        }
      />
    );
  }
  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive" data-testid={ids.loadError}>
        {t('admin.loadError')}
      </p>
    );
  }
  if (loading) return <Skeleton className="h-64 w-full" />;
  return (
    <Empty className="py-12" data-testid={ids.empty}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldOff />
        </EmptyMedia>
        <EmptyTitle>{activeOnly ? t('admin.emptyActiveTitle') : t('emptyTitle')}</EmptyTitle>
        <EmptyDescription>
          {activeOnly ? t('admin.emptyActiveDescription') : t('admin.emptyDescription')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
