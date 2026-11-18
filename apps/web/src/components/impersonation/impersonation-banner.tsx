'use client';

import { Badge, Button, Card, CardContent } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { type ImpersonationSession, useImpersonationSession } from './use-impersonation-session';

const { impersonationBanner: ids } = testIds;

/**
 * Banner for a tab that acts as another user, and the notice once that session is over.
 * The layout owns the session state (it also turns "Log out" into Exit) and passes it in.
 */
export function ImpersonationBannerView({ session }: { session: ImpersonationSession }) {
  const t = useTranslations('auth');

  if (!session.active) return null;

  if (session.ended) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="impersonation-ended-title"
        data-testid={ids.endedNotice}
      >
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-4 pt-6 text-center">
            <p id="impersonation-ended-title" className="font-medium">
              {t('impersonationSessionEnded')}
            </p>
            <p className="text-sm text-muted-foreground">{t('impersonationTabClosing')}</p>
            <Button variant="outline" onClick={() => window.close()} data-testid={ids.closeBtn}>
              {t('closeTab')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-black"
      role="status"
      data-testid={ids.banner}
    >
      <span className="flex flex-wrap items-center gap-2 font-medium">
        {t('impersonationBanner', { name: session.displayName ?? t('or') })}
        {session.readOnly && (
          <Badge
            variant="outline"
            className="border-black text-black"
            title={t('impersonationViewOnlyTitle')}
            data-testid={ids.viewOnlyBadge}
          >
            {t('impersonationViewOnly')}
          </Badge>
        )}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="border-black text-black hover:bg-amber-600"
        onClick={session.exit}
        disabled={session.exiting}
        data-testid={ids.exitBtn}
      >
        {t('exitImpersonation')}
      </Button>
    </div>
  );
}

/** The banner with its own session state, for a page that has no other use for it. */
export function ImpersonationBanner() {
  return <ImpersonationBannerView session={useImpersonationSession()} />;
}
