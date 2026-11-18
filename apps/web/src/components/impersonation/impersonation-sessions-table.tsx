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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { useTranslations } from 'next-intl';
import * as React from 'react';

export interface ImpersonationSessionRow {
  id: string;
  impersonatorName?: string | null;
  impersonatorScope: string;
  targetUserName?: string | null;
  targetTenantName?: Record<string, string> | null;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedReason?: string | null;
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
}

export type SessionDisplayStatus = 'ACTIVE' | 'ENDED' | 'EXPIRED' | 'REVOKED';

/** A session someone else cut short reads as Revoked, not as an ordinary end. */
export function sessionDisplayStatus(
  session: Pick<ImpersonationSessionRow, 'status' | 'endedReason'>,
): SessionDisplayStatus {
  return session.status === 'ENDED' && session.endedReason === 'revoked'
    ? 'REVOKED'
    : session.status;
}

const STATUS_VARIANT: Record<
  SessionDisplayStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'default',
  ENDED: 'secondary',
  EXPIRED: 'outline',
  REVOKED: 'destructive',
};

export interface ImpersonationSessionsTableIds {
  table: string;
  row: (id: string) => string;
  statusBadge: (id: string) => string;
  terminateBtn: (id: string) => string;
  terminateDialog: string;
  terminateConfirm: string;
}

export interface ImpersonationSessionsTableProps {
  sessions: ImpersonationSessionRow[];
  ids: ImpersonationSessionsTableIds;
  /** Admin lists every scope, so it says where the impersonator acted from. */
  showScope?: boolean;
  /** Column heading for the impersonator; resellers call them "Team member". */
  impersonatorLabel: string;
  /** Ends the session. Throw to keep the dialog open; the caller reports the failure. */
  onTerminate?: (session: ImpersonationSessionRow) => Promise<void>;
  /** Body of the confirmation for this session. */
  terminateDescription: (session: ImpersonationSessionRow) => string;
}

/** Impersonation sessions with a Terminate action on active ones. Used by the admin and reseller pages. */
export function ImpersonationSessionsTable({
  sessions,
  ids,
  showScope = false,
  impersonatorLabel,
  onTerminate,
  terminateDescription,
}: ImpersonationSessionsTableProps) {
  const t = useTranslations('impersonationSessions');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();
  const [target, setTarget] = React.useState<ImpersonationSessionRow | null>(null);
  const [terminating, setTerminating] = React.useState(false);

  const when = (value: string) => format(new Date(value), 'dd/MM/yyyy, HH:mm');

  const confirm = async (event: React.MouseEvent) => {
    // Stay open until the request settles, so a refusal is seen.
    event.preventDefault();
    if (!target || !onTerminate) return;
    setTerminating(true);
    try {
      await onTerminate(target);
      setTarget(null);
    } catch {
      // Reported by the caller.
    } finally {
      setTerminating(false);
    }
  };

  return (
    <>
      <Table data-testid={ids.table}>
        <TableHeader>
          <TableRow>
            <TableHead>{impersonatorLabel}</TableHead>
            <TableHead>{t('columns.targetUser')}</TableHead>
            <TableHead>{t('columns.institute')}</TableHead>
            <TableHead>{t('columns.reason')}</TableHead>
            <TableHead>{t('columns.startedAt')}</TableHead>
            <TableHead>{t('columns.expiresAt')}</TableHead>
            <TableHead>{t('columns.status')}</TableHead>
            {onTerminate && <TableHead className="text-end">{t('columns.actions')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => {
            const status = sessionDisplayStatus(session);
            return (
              <TableRow key={session.id} data-testid={ids.row(session.id)}>
                <TableCell className="font-medium">
                  {session.impersonatorName ?? '—'}
                  {showScope && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t.has(`scopes.${session.impersonatorScope}`)
                        ? t(`scopes.${session.impersonatorScope}`)
                        : session.impersonatorScope}
                    </span>
                  )}
                </TableCell>
                <TableCell>{session.targetUserName ?? '—'}</TableCell>
                <TableCell>
                  {session.targetTenantName ? resolveI18n(session.targetTenantName) : '—'}
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <span className="line-clamp-2 break-words" title={session.reason}>
                    {session.reason || t('noReason')}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{when(session.startedAt)}</TableCell>
                <TableCell className="whitespace-nowrap">{when(session.expiresAt)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[status]} data-testid={ids.statusBadge(session.id)}>
                    {t(`status.${status}`)}
                  </Badge>
                </TableCell>
                {onTerminate && (
                  <TableCell className="text-end">
                    {session.status === 'ACTIVE' && (
                      <Button
                        variant="destructive"
                        size="sm"
                        title={t('terminateTitle')}
                        onClick={() => setTarget(session)}
                        data-testid={ids.terminateBtn(session.id)}
                      >
                        {t('terminate')}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !terminating) setTarget(null);
        }}
      >
        <AlertDialogContent data-testid={ids.terminateDialog}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('terminateConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {target ? terminateDescription(target) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={terminating}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirm}
              disabled={terminating}
              data-testid={ids.terminateConfirm}
            >
              {t('terminate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
