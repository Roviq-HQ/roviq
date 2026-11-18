'use client';

import { Link } from '@roviq/i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  useMediaQuery,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import * as React from 'react';

const { institutePeople } = testIds;

export type PersonKind = 'student' | 'guardian';

interface PersonRef {
  kind: PersonKind;
  id: string;
}

interface PersonDetailContextValue {
  open: (person: PersonRef) => void;
  /** True inside the popup: views hide page-only chrome (back button, breadcrumbs). */
  embedded: boolean;
  /** Leaves the current popup entry — goes back one step, or closes when it is the first. */
  exit: () => void;
}

const PersonDetailContext = React.createContext<PersonDetailContextValue | null>(null);

const PAGE_CONTEXT: PersonDetailContextValue = {
  open: () => undefined,
  embedded: false,
  exit: () => undefined,
};

/** Detail views use this to know whether they render as a page or inside the popup. */
export function usePersonDetailContext(): PersonDetailContextValue {
  return React.useContext(PersonDetailContext) ?? PAGE_CONTEXT;
}

export function personDetailHref({ kind, id }: PersonRef): string {
  return `/institute/people/${kind === 'student' ? 'students' : 'guardians'}/${id}`;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// Dynamic imports keep the views out of this module's static graph: the views
// render PersonNameLink themselves, so a static import would be a cycle.
const StudentDetailView = dynamic(
  () => import('./students/[id]/student-detail-view').then((m) => m.StudentDetailView),
  { loading: DetailSkeleton },
);
const GuardianDetailView = dynamic(
  () => import('./guardians/[id]/guardian-detail-view').then((m) => m.GuardianDetailView),
  { loading: DetailSkeleton },
);

/**
 * Lets any linked student or guardian name open that person's full detail
 * view in a popup. Inside the popup, linked names replace the content and
 * push a Back step instead of stacking popups.
 */
export function PersonDetailDialogProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('peopleLinks');
  const isMobile = useMediaQuery('(max-width: 1024px)');
  const [stack, setStack] = React.useState<PersonRef[]>([]);
  const current = stack.at(-1);

  const open = React.useCallback((person: PersonRef) => {
    setStack((prev) => {
      const top = prev.at(-1);
      return top?.kind === person.kind && top.id === person.id ? prev : [...prev, person];
    });
  }, []);
  const back = React.useCallback(() => setStack((prev) => prev.slice(0, -1)), []);
  const close = React.useCallback(() => setStack([]), []);

  const pageValue = React.useMemo(() => ({ open, embedded: false, exit: close }), [open, close]);
  const embeddedValue = React.useMemo(() => ({ open, embedded: true, exit: back }), [open, back]);

  const title = current ? t(`dialog.${current.kind}Title`) : '';
  const toolbar = current ? (
    <div className="flex items-center justify-between gap-2">
      {stack.length > 1 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={back}
          title={t('dialog.back')}
          data-testid={institutePeople.personDialogBack}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('dialog.back')}
        </Button>
      ) : (
        <span />
      )}
      <Button variant="outline" size="sm" asChild>
        <Link
          href={personDetailHref(current)}
          onClick={close}
          title={t('dialog.openFullPage')}
          data-testid={institutePeople.personDialogOpenPage}
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          {t('dialog.openFullPage')}
        </Link>
      </Button>
    </div>
  ) : null;

  const body = current ? (
    <PersonDetailContext.Provider value={embeddedValue}>
      {/* key remounts the view so tab state never leaks between people */}
      {current.kind === 'student' ? (
        <StudentDetailView key={`s-${current.id}`} studentId={current.id} />
      ) : (
        <GuardianDetailView key={`g-${current.id}`} guardianId={current.id} />
      )}
    </PersonDetailContext.Provider>
  ) : null;

  const onOpenChange = (next: boolean) => {
    if (!next) close();
  };

  return (
    <PersonDetailContext.Provider value={pageValue}>
      {children}
      {isMobile ? (
        <Sheet open={!!current} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            className="max-h-[92vh] overflow-y-auto"
            data-testid={institutePeople.personDialog}
          >
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription className="sr-only">{t('dialog.description')}</SheetDescription>
              {toolbar}
            </SheetHeader>
            <div className="px-4 pb-8">{body}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={!!current} onOpenChange={onOpenChange}>
          <DialogContent
            className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-6xl"
            data-testid={institutePeople.personDialog}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="sr-only">{t('dialog.description')}</DialogDescription>
              {toolbar}
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      )}
    </PersonDetailContext.Provider>
  );
}

/**
 * A linked student/guardian name. Opens the popup when a provider is mounted;
 * otherwise it is a plain link to the detail page.
 */
export function PersonNameLink({
  kind,
  id,
  children,
  className,
}: PersonRef & { children: React.ReactNode; className?: string }) {
  const t = useTranslations('peopleLinks');
  const ctx = React.useContext(PersonDetailContext);
  const label = t('openDetails', { name: typeof children === 'string' ? children : '' });
  const linkClass = `font-medium text-primary underline-offset-4 hover:underline focus-visible:underline ${className ?? ''}`;

  if (!ctx) {
    return (
      <Link
        href={personDetailHref({ kind, id })}
        className={linkClass}
        title={label}
        data-testid={institutePeople.personLink(kind, id)}
      >
        {children}
      </Link>
    );
  }

  return (
    <Button
      type="button"
      variant="link"
      className={`h-auto p-0 text-start ${linkClass}`}
      onClick={(e) => {
        // Rows that are themselves clickable must not also navigate.
        e.stopPropagation();
        ctx.open({ kind, id });
      }}
      title={label}
      data-testid={institutePeople.personLink(kind, id)}
    >
      {children}
    </Button>
  );
}
