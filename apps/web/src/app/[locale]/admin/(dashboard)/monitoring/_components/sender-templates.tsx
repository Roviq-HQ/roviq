'use client';

import { extractGraphQLErrorCode, useMutation, useQuery } from '@roviq/graphql';
import { Badge, Button, Can, Skeleton } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AdminMessagingTemplatesDocument,
  type AdminMessagingTemplatesQuery,
  AdminSyncWhatsAppTemplatesDocument,
} from '../_lib/notification-health.graphql.generated';
import { SectionError } from './section-error';

const { adminMonitoring: ids } = testIds;

type Template = AdminMessagingTemplatesQuery['adminMessagingTemplates'][number];

/** Why a template is not sent, or null when it is. */
function problemOf(t: Template): 'pending' | 'rejected' | 'changed' | null {
  if (t.sendable) return t.outOfStep ? 'changed' : null;
  if (t.status === 'PENDING') return 'pending';
  if (t.status === 'APPROVED') return 'changed';
  return 'rejected';
}

/**
 * The WhatsApp templates of one sender's provider account (ROV-333): how many are approved,
 * waiting or refused, which ones and why, and a way to submit the missing ones now.
 */
export function SenderTemplates({
  senderId,
  hasAccount,
}: {
  senderId: string;
  hasAccount: boolean;
}) {
  const t = useTranslations('adminMonitoring.notifications.templates');
  const { data, error, loading, refetch } = useQuery(AdminMessagingTemplatesDocument, {
    variables: { senderId },
    skip: !hasAccount,
  });
  const [sync, { loading: syncing }] = useMutation(AdminSyncWhatsAppTemplatesDocument);

  if (!hasAccount) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid={ids.senderTemplatesNoAccount(senderId)}
      >
        {t('noAccount')}
      </p>
    );
  }
  if (error && !data) {
    return (
      <SectionError
        error={error}
        onRetry={() => void refetch()}
        testId={ids.senderTemplatesError(senderId)}
        retryTestId={ids.senderTemplatesRetry(senderId)}
      />
    );
  }
  if (loading && !data) return <Skeleton className="h-6 w-full" aria-busy="true" />;

  const rows = data?.adminMessagingTemplates ?? [];
  const count = (p: ReturnType<typeof problemOf>) => rows.filter((r) => problemOf(r) === p).length;
  const problems = rows.filter((r) => problemOf(r) === 'rejected' || problemOf(r) === 'changed');

  const onSync = async () => {
    try {
      await sync({ variables: { senderId } });
      toast.success(t('syncStarted'));
      // The sync runs in the background; its first answers arrive within seconds.
      setTimeout(() => void refetch(), 5_000);
    } catch (err) {
      const code = extractGraphQLErrorCode(err);
      toast.error(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.other'));
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid={ids.senderTemplates(senderId)}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" data-testid={ids.senderTemplatesApproved(senderId)}>
          {t('approved', { count: count(null) })}
        </Badge>
        <Badge variant="outline">{t('pending', { count: count('pending') })}</Badge>
        <Badge variant="outline" className={count('rejected') ? 'text-destructive' : undefined}>
          {t('rejected', { count: count('rejected') })}
        </Badge>
        <Badge
          variant="outline"
          className={count('changed') ? 'text-amber-700 dark:text-amber-400' : undefined}
        >
          {t('changed', { count: count('changed') })}
        </Badge>
        <Can I="update" a="MessagingSender">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ms-auto"
            disabled={syncing}
            title={t('syncTitle')}
            onClick={() => void onSync()}
            data-testid={ids.senderTemplatesSync(senderId)}
          >
            <RefreshCw aria-hidden="true" className={syncing ? 'animate-spin' : undefined} />
            {t('sync')}
          </Button>
        </Can>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('none')}</p>
      ) : problems.length > 0 ? (
        <ul
          className="flex flex-col gap-1 text-xs"
          data-testid={ids.senderTemplatesProblems(senderId)}
        >
          {problems.map((r) => (
            <li key={`${r.name}:${r.language}`}>
              <span className="font-mono">
                {r.name} ({r.language})
              </span>
              {': '}
              {problemOf(r) === 'rejected'
                ? t('rejectedLine', { status: r.status, reason: r.rejectedReason ?? t('noReason') })
                : r.outOfStep
                  ? t('outOfStepLine')
                  : t('categoryLine', {
                      declared: r.declaredCategory,
                      approved: r.approvedCategory ?? '—',
                    })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
