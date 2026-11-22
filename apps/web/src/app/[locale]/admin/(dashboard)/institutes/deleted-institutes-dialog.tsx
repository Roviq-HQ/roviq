'use client';

import { extractGraphQLErrorCode, gql, useMutation, useQuery } from '@roviq/graphql';
import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Button,
  Can,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Skeleton,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import type {
  AdminListDeletedInstitutesQuery,
  AdminRestoreInstituteMutation,
  AdminRestoreInstituteMutationVariables,
} from './deleted-institutes-dialog.generated';

const { adminInstitutes } = testIds;

const LIST_DELETED = gql`
  query AdminListDeletedInstitutes {
    adminListDeletedInstitutes {
      id
      name
      code
      status
      deletedAt
    }
  }
`;

const RESTORE = gql`
  mutation AdminRestoreInstitute($id: ID!) {
    adminRestoreInstitute(id: $id) {
      id
      status
    }
  }
`;

/** The platform recycle bin: deleted institutes, each with a Restore action. */
export function DeletedInstitutesDialog({ onRestored }: { onRestored: () => void }) {
  const t = useTranslations('adminInstitutes.deleted');
  const tStatus = useTranslations('adminInstitutes.statuses');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();
  const [open, setOpen] = React.useState(false);
  const { data, loading, error, refetch } = useQuery<AdminListDeletedInstitutesQuery>(
    LIST_DELETED,
    { skip: !open, fetchPolicy: 'network-only' },
  );
  const [restore] = useMutation<
    AdminRestoreInstituteMutation,
    AdminRestoreInstituteMutationVariables
  >(RESTORE);
  const [restoringId, setRestoringId] = React.useState<string | null>(null);

  async function runRestore(id: string) {
    setRestoringId(id);
    try {
      await restore({ variables: { id } });
      toast.success(t('restored'));
      await refetch();
      onRestored();
    } catch (err) {
      toast.error(
        extractGraphQLErrorCode(err) === 'INSTITUTE_NOT_FOUND' ? t('alreadyRestored') : t('failed'),
      );
      await refetch();
    } finally {
      setRestoringId(null);
    }
  }

  const rows = data?.adminListDeletedInstitutes ?? [];

  return (
    <Can I="restore" a="Institute">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" title={t('open')} data-testid={adminInstitutes.deletedOpenBtn}>
            <Trash2 className="size-4" />
            {t('open')}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl" data-testid={adminInstitutes.deletedDialog}>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          {loading && <Skeleton className="h-24 w-full" />}
          {!loading && error && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-destructive">{t('loadFailed')}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} title={t('retry')}>
                {t('retry')}
              </Button>
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid={adminInstitutes.deletedEmpty}>
              {t('empty')}
            </p>
          )}
          {rows.length > 0 && (
            <ul className="max-h-[60vh] divide-y overflow-y-auto">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  data-testid={adminInstitutes.deletedRow(row.id)}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{resolveI18n(row.name)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('rowMeta', {
                        code: row.code ?? '—',
                        date: format(new Date(row.deletedAt), 'dd/MM/yyyy'),
                        status: tStatus(row.status),
                      })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => runRestore(row.id)}
                    disabled={restoringId !== null}
                    title={t('restore')}
                    data-testid={adminInstitutes.deletedRestoreBtn(row.id)}
                  >
                    <ArchiveRestore className="size-4" />
                    {restoringId === row.id ? t('restoring') : t('restore')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </Can>
  );
}
