'use client';

import { useFormatDate } from '@roviq/i18n';
import { Can, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { useTeamMember, useTeamMemberActivity } from '../use-reseller-team';
import { TeamRoleBadge, TeamStatusBadge } from './team-badges';
import { useMemberName } from './use-member-name';

const { resellerTeam } = testIds;

export function MemberDetailSheet({
  membershipId,
  onClose,
}: {
  membershipId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('resellerTeam');
  const { format, formatDistance } = useFormatDate();
  const memberName = useMemberName();
  const { data, loading, error } = useTeamMember(membershipId);
  const member = data?.resellerGetTeamMember;

  const day = (value: string) => format(new Date(value), 'dd/MM/yyyy');
  const ago = (value: string) => formatDistance(new Date(value), new Date());

  return (
    <Sheet open={membershipId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-lg"
        data-testid={resellerTeam.detailSheet}
      >
        <SheetHeader>
          <SheetTitle data-testid={resellerTeam.detailName}>
            {member ? memberName(member) : t('detail.title')}
          </SheetTitle>
          <SheetDescription data-testid={resellerTeam.detailEmail}>
            {member?.email ?? ''}
          </SheetDescription>
        </SheetHeader>

        {!member ? (
          <p
            className="px-4 text-sm text-muted-foreground"
            data-testid={
              loading && !error ? resellerTeam.detailLoading : resellerTeam.detailNotFound
            }
          >
            {loading && !error ? t('detail.loading') : t('detail.notFound')}
          </p>
        ) : (
          <div className="space-y-6 px-4 pb-6">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Item label={t('detail.roviqId')}>{member.username}</Item>
              <Item label={t('detail.role')}>
                <TeamRoleBadge name={member.roleName} />
              </Item>
              <Item label={t('detail.status')}>
                <TeamStatusBadge isActive={member.isActive} />
              </Item>
              <Item label={t('detail.joined')}>{day(member.joinedAt)}</Item>
              <Item label={t('detail.lastActive')}>
                {member.lastActiveAt ? ago(member.lastActiveAt) : t('never')}
              </Item>
            </dl>

            <section data-testid={resellerTeam.detailSessions}>
              <h3 className="mb-2 text-sm font-semibold">{t('detail.sessions')}</h3>
              {member.sessions === null || member.sessions === undefined ? (
                <p className="text-sm text-muted-foreground">{t('detail.sessionsHidden')}</p>
              ) : member.sessions.length === 0 ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid={resellerTeam.detailSessionsEmpty}
                >
                  {t('detail.sessionsEmpty')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {member.sessions.map((session) => (
                    <li
                      key={session.id}
                      className="rounded-md border p-3 text-sm"
                      data-testid={resellerTeam.detailSessionRow(session.id)}
                    >
                      <p className="break-words font-medium">
                        {session.userAgent ?? t('detail.sessionUnknownDevice')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          session.ipAddress,
                          t('detail.sessionStarted', { date: ago(session.createdAt) }),
                          session.lastUsedAt
                            ? t('detail.sessionLastUsed', { date: ago(session.lastUsedAt) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section data-testid={resellerTeam.detailActivity}>
              <h3 className="mb-2 text-sm font-semibold">{t('detail.activity')}</h3>
              <Can I="read" a="AuditLog" passThrough>
                {(allowed: boolean) =>
                  allowed ? (
                    <MemberActivity userId={member.userId} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('detail.activityHidden')}</p>
                  )
                }
              </Can>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MemberActivity({ userId }: { userId: string }) {
  const t = useTranslations('resellerTeam');
  const { format } = useFormatDate();
  const tAudit = useTranslations('auditLogs');
  const { data, loading } = useTeamMemberActivity(userId, true);
  const entries = data?.resellerAuditLogs.edges.map((edge) => edge.node) ?? [];

  if (loading && entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('detail.loading')}</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={resellerTeam.detailActivityEmpty}>
        {t('detail.activityEmpty')}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
          data-testid={resellerTeam.detailActivityRow(entry.id)}
        >
          <span className="min-w-0">
            <span className="block font-medium">
              {tAudit.has(`actionTypes.${entry.actionType}`)
                ? tAudit(`actionTypes.${entry.actionType}`)
                : entry.actionType}
              {' · '}
              {entry.entityType}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{entry.action}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {format(new Date(entry.createdAt), 'dd/MM/yyyy, HH:mm')}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
