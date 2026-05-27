'use client';

import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { useResellerInstitutes } from '../../institutes/use-reseller-institutes';
import {
  type ResellerImpersonationSessionNode,
  useResellerImpersonationSessions,
  useTerminateImpersonationSession,
} from './use-reseller-impersonation-sessions';

const { resellerImpersonation } = testIds;

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  ACTIVE: 'default',
  ENDED: 'secondary',
  EXPIRED: 'outline',
};

export default function ResellerImpersonationSessionsPage() {
  const t = useTranslations('impersonationSessions');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();

  const [instituteFilter, setInstituteFilter] = React.useState<string>('all');
  const [terminateTarget, setTerminateTarget] =
    React.useState<ResellerImpersonationSessionNode | null>(null);

  const { sessions, loading, refetch } = useResellerImpersonationSessions({ first: 50 });
  const { institutes } = useResellerInstitutes();
  const [terminate, { loading: terminating }] = useTerminateImpersonationSession();

  const visibleSessions = React.useMemo(
    () =>
      instituteFilter === 'all'
        ? sessions
        : sessions.filter((s) => s.targetTenantId === instituteFilter),
    [sessions, instituteFilter],
  );

  const fmt = (d?: string | Date | null) => (d ? format(new Date(d), 'dd MMM yyyy, HH:mm') : '—');

  const handleTerminate = async () => {
    if (!terminateTarget) return;
    try {
      await terminate({ variables: { sessionId: terminateTarget.id } });
      toast.success(t('terminateSuccess'));
      setTerminateTarget(null);
      await refetch();
    } catch {
      toast.error(t('terminateError'));
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
                <Empty className="py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ShieldOff />
                    </EmptyMedia>
                    <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
                    <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Table data-testid={resellerImpersonation.table}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('columns.impersonator')}</TableHead>
                      <TableHead>{t('columns.targetUser')}</TableHead>
                      <TableHead>{t('columns.institute')}</TableHead>
                      <TableHead>{t('columns.startedAt')}</TableHead>
                      <TableHead>{t('columns.status')}</TableHead>
                      <TableHead className="text-end">{t('columns.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleSessions.map((session) => (
                      <TableRow
                        key={session.id}
                        data-testid={resellerImpersonation.row(session.id)}
                      >
                        <TableCell className="font-medium">
                          {session.impersonatorName ?? '—'}
                        </TableCell>
                        <TableCell>{session.targetUserName ?? '—'}</TableCell>
                        <TableCell>
                          {session.targetTenantName ? resolveI18n(session.targetTenantName) : '—'}
                        </TableCell>
                        <TableCell>{fmt(session.startedAt)}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[session.status] ?? 'outline'}>
                            {t(`status.${session.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end">
                          {session.status === 'ACTIVE' && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setTerminateTarget(session)}
                              data-testid={resellerImpersonation.terminateBtn(session.id)}
                            >
                              {t('terminate')}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          ) : (
            <div className="flex h-[50vh] items-center justify-center">
              <p className="text-muted-foreground">{t('accessDenied')}</p>
            </div>
          )
        }
      </Can>

      <AlertDialog
        open={terminateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTerminateTarget(null);
        }}
      >
        <AlertDialogContent data-testid={resellerImpersonation.terminateDialog}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('terminateConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('terminateConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTerminate}
              disabled={terminating}
              data-testid={resellerImpersonation.terminateConfirm}
            >
              {t('terminate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
