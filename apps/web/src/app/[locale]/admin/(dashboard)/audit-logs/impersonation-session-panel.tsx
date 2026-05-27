'use client';

import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Badge,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { useAuditLogs } from './use-audit-logs';
import { useImpersonationSessions } from './use-impersonation-sessions';

const { adminAuditLogs } = testIds;

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  ACTIVE: 'default',
  ENDED: 'secondary',
  EXPIRED: 'outline',
};

interface ImpersonationSessionPanelProps {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Side panel showing a single impersonation session's details plus every audit entry recorded
 * during that session. Opened from the impersonation tab by clicking a session id.
 */
export function ImpersonationSessionPanel({
  sessionId,
  open,
  onOpenChange,
}: ImpersonationSessionPanelProps) {
  const t = useTranslations('auditLogs');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();

  const { sessions, loading } = useImpersonationSessions(
    sessionId ? { sessionId } : { sessionId: undefined },
  );
  const session = sessions[0] ?? null;

  // Audit entries written during this session.
  const { logs } = useAuditLogs({
    filter: sessionId
      ? ({ impersonationSessionId: sessionId } as Parameters<typeof useAuditLogs>[0]['filter'])
      : undefined,
    first: 50,
  });

  const fmt = (d?: string | Date | null) =>
    d ? format(new Date(d), 'dd MMM yyyy, HH:mm:ss') : '—';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full overflow-hidden sm:max-w-xl"
        data-testid={adminAuditLogs.sessionPanel}
      >
        <SheetHeader>
          <SheetTitle>{t('session.title')}</SheetTitle>
          <SheetDescription>{t('session.description')}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-8rem)] pe-4">
          {loading && !session ? (
            <p className="text-sm text-muted-foreground">{t('session.loading')}</p>
          ) : !session ? (
            <p className="text-sm text-muted-foreground">{t('session.notFound')}</p>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <Badge variant={STATUS_VARIANT[session.status] ?? 'outline'}>
                  {t(`session.status.${session.status}`)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t(`scopes.${session.impersonatorScope}`)}
                </span>
              </div>

              <dl className="grid grid-cols-1 gap-3 text-sm">
                <Field label={t('session.impersonator')} value={session.impersonatorName} />
                <Field label={t('session.targetUser')} value={session.targetUserName} />
                <Field
                  label={t('session.institute')}
                  value={session.targetTenantName ? resolveI18n(session.targetTenantName) : '—'}
                />
                <Field label={t('session.reason')} value={session.reason} />
                <Field label={t('session.ip')} value={session.ipAddress} />
                <Field label={t('session.startedAt')} value={fmt(session.startedAt)} />
                <Field label={t('session.expiresAt')} value={fmt(session.expiresAt)} />
                <Field label={t('session.endedAt')} value={fmt(session.endedAt)} />
                <Field label={t('session.endedReason')} value={session.endedReason} />
                <Field label={t('session.otpVerified')} value={fmt(session.otpVerified)} />
                <Field label={t('session.otpVerifiedBy')} value={session.otpVerifiedByName} />
              </dl>

              <div>
                <h4 className="mb-2 text-sm font-semibold">
                  {t('session.auditEntries', { count: logs.length })}
                </h4>
                <ul className="space-y-2" data-testid={adminAuditLogs.sessionAuditList}>
                  {logs.length === 0 ? (
                    <li className="text-sm text-muted-foreground">{t('session.noAuditEntries')}</li>
                  ) : (
                    logs.map((log) => (
                      <li key={log.id} className="rounded-md border p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{log.action}</span>
                          <span className="text-xs text-muted-foreground">
                            {fmt(log.createdAt)}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {log.entityType}
                          {log.entityId ? ` · ${log.entityId}` : ''}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words">{value || '—'}</dd>
    </div>
  );
}
