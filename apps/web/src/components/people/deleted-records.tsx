'use client';

import { extractGraphQLError, extractGraphQLErrorCode } from '@roviq/graphql';
import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Button,
  Can,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  useMediaQuery,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ArchiveRestore, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import {
  type DeletedPerson,
  type PersonKind,
  useDeletedPeople,
  useDeletePerson,
  useRestorePerson,
} from './use-deleted-records';

const { deletedRecords } = testIds;

const SUBJECT = { student: 'Student', staff: 'Staff', guardian: 'Guardian' } as const;
const KNOWN_ERROR_CODES = [
  'HAS_ACTIVE_ENROLLMENTS',
  'ADMISSION_NUMBER_TAKEN',
  'GUARDIAN_IS_ONLY_GUARDIAN',
] as const;
type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

function isKnownErrorCode(code: string | null): code is KnownErrorCode {
  return KNOWN_ERROR_CODES.some((known) => known === code);
}

function useErrorDescription() {
  const t = useTranslations('deletedRecords');
  return React.useCallback(
    (error: unknown): string => {
      const code = extractGraphQLErrorCode(error);
      return isKnownErrorCode(code) ? t(`errors.${code}`) : extractGraphQLError(error, '');
    },
    [t],
  );
}

/** Opens the list of soft-deleted students, staff or guardians, each with a Restore action. */
export function DeletedRecordsButton({ kind }: { kind: PersonKind }) {
  const t = useTranslations('deletedRecords');
  const [open, setOpen] = React.useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const body = <DeletedRecordsList kind={kind} active={open} />;

  return (
    <Can I="restore" a={SUBJECT[kind]}>
      <Button
        variant="outline"
        className="min-h-11"
        onClick={() => setOpen(true)}
        title={t(`${kind}.button`)}
        data-testid={deletedRecords.openBtn(kind)}
      >
        <ArchiveRestore aria-hidden="true" className="size-4" />
        {t(`${kind}.button`)}
      </Button>
      {isDesktop ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className="flex max-h-[80vh] flex-col sm:max-w-2xl"
            data-testid={deletedRecords.panel(kind)}
          >
            <DialogHeader>
              <DialogTitle>{t(`${kind}.title`)}</DialogTitle>
              <DialogDescription>{t(`${kind}.description`)}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
          </DialogContent>
        </Dialog>
      ) : (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="flex max-h-[85vh] flex-col"
            data-testid={deletedRecords.panel(kind)}
          >
            <SheetHeader>
              <SheetTitle>{t(`${kind}.title`)}</SheetTitle>
              <SheetDescription>{t(`${kind}.description`)}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{body}</div>
          </SheetContent>
        </Sheet>
      )}
    </Can>
  );
}

function DeletedRecordsList({ kind, active }: { kind: PersonKind; active: boolean }) {
  const t = useTranslations('deletedRecords');
  const resolveI18n = useI18nField();
  const { format: formatDate } = useFormatDate();
  const describeError = useErrorDescription();
  const { data, loading, error, refetch } = useDeletedPeople(kind, !active);
  const [restore] = useRestorePerson(kind);
  const [restoringId, setRestoringId] = React.useState<string | null>(null);

  const nameOf = (person: DeletedPerson) =>
    [resolveI18n(person.firstName), resolveI18n(person.lastName)].filter(Boolean).join(' ');

  const handleRestore = async (person: DeletedPerson) => {
    const name = nameOf(person);
    setRestoringId(person.id);
    try {
      await restore({ variables: { id: person.id } });
      toast.success(t('restored', { name }));
    } catch (err) {
      toast.error(t('restoreFailed', { name }), {
        description: describeError(err),
        duration: Number.POSITIVE_INFINITY,
      });
    } finally {
      setRestoringId(null);
    }
  };

  if (error && !data) {
    return (
      <Empty data-testid={deletedRecords.error(kind)}>
        <EmptyHeader>
          <EmptyTitle>{t('loadFailed')}</EmptyTitle>
          <EmptyDescription>{describeError(error)}</EmptyDescription>
        </EmptyHeader>
        <Button
          variant="outline"
          onClick={() => refetch()}
          data-testid={deletedRecords.retryBtn(kind)}
        >
          {t('retry')}
        </Button>
      </Empty>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const people = data?.deleted ?? [];
  if (people.length === 0) {
    return (
      <Empty data-testid={deletedRecords.empty(kind)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trash2 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t(`${kind}.empty`)}</EmptyTitle>
          <EmptyDescription>{t(`${kind}.emptyDescription`)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="divide-y">
      {people.map((person) => {
        const name = nameOf(person);
        return (
          <li
            key={person.id}
            className="flex items-center justify-between gap-3 py-3"
            data-testid={deletedRecords.row(person.id)}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {person.identifier ? `${t(`${kind}.identifier`)} ${person.identifier} · ` : ''}
                {t('columns.deletedOn')} {formatDate(new Date(person.deletedAt), 'dd/MM/yyyy')}
              </p>
            </div>
            <Button
              variant="outline"
              className="min-h-11 shrink-0"
              disabled={restoringId !== null}
              onClick={() => handleRestore(person)}
              title={t('restoreTitle', { name })}
              data-testid={deletedRecords.restoreBtn(person.id)}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              {t('restore')}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Delete action for a person's detail page: states the consequence, then
 * soft-deletes and offers Undo on the success toast.
 */
export function DeletePersonButton({
  kind,
  id,
  name,
  onDeleted,
}: {
  kind: PersonKind;
  id: string;
  name: string;
  /** Called after a successful delete — typically navigates back to the list. */
  onDeleted: () => void;
}) {
  const t = useTranslations('deletedRecords');
  const tCommon = useTranslations('common');
  const describeError = useErrorDescription();
  const [open, setOpen] = React.useState(false);
  const [deletePerson, { loading }] = useDeletePerson(kind);
  const [restore] = useRestorePerson(kind);

  const handleUndo = async () => {
    try {
      await restore({ variables: { id } });
      toast.success(t('restored', { name }));
    } catch (err) {
      toast.error(t('restoreFailed', { name }), {
        description: describeError(err),
        duration: Number.POSITIVE_INFINITY,
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deletePerson({ variables: { id } });
      setOpen(false);
      toast.success(t('deleted', { name }), {
        duration: 5000,
        action: { label: t('undo'), onClick: handleUndo },
      });
      onDeleted();
    } catch (err) {
      toast.error(t('deleteFailed', { name }), {
        description: describeError(err),
        duration: Number.POSITIVE_INFINITY,
      });
    }
  };

  return (
    <Can I="delete" a={SUBJECT[kind]}>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() => setOpen(true)}
        title={t(`${kind}.deleteButton`)}
        data-testid={deletedRecords.deleteBtn(kind)}
      >
        <Trash2 aria-hidden="true" className="size-4" />
        {t(`${kind}.deleteButton`)}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid={deletedRecords.deleteDialog(kind)}>
          <DialogHeader>
            <DialogTitle>{t(`${kind}.deleteTitle`, { name })}</DialogTitle>
            <DialogDescription>{t(`${kind}.deleteConsequence`, { name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              data-testid={deletedRecords.deleteCancelBtn(kind)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={loading}
              onClick={handleDelete}
              data-testid={deletedRecords.deleteConfirmBtn(kind)}
            >
              {loading ? t('deleting') : t('confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Can>
  );
}
