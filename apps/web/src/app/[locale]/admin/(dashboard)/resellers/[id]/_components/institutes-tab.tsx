'use client';

import { gql, useMutation, useQuery } from '@roviq/graphql';
import type { InstituteStatus } from '@roviq/graphql/generated';
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Field,
  FieldLabel,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ArrowRightLeft, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { ResellerCombobox } from '../../../institutes/_components/reseller-combobox';
import { useResellerErrorMessage } from '../../use-reseller-error-message';
import {
  AdminResellerInstitutesDocument,
  AdminResellerReassignInstituteDocument,
} from './institutes-tab.generated';

const { adminResellerDetail } = testIds;
const PAGE_SIZE = 20;

export const ADMIN_RESELLER_INSTITUTES = gql`
  query AdminResellerInstitutes($resellerId: String!, $first: Int, $after: String) {
    adminListInstitutes(filter: { resellerId: $resellerId, first: $first, after: $after }) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          code
          status
          createdAt
        }
      }
    }
  }
`;

export const ADMIN_RESELLER_REASSIGN_INSTITUTE = gql`
  mutation AdminResellerReassignInstitute($id: ID!, $newResellerId: ID!) {
    adminReassignInstituteReseller(id: $id, newResellerId: $newResellerId) {
      id
      resellerId
    }
  }
`;

const STATUS_VARIANT: Record<InstituteStatus, 'default' | 'secondary' | 'destructive' | 'outline'> =
  {
    PENDING_APPROVAL: 'outline',
    PENDING: 'outline',
    ACTIVE: 'default',
    INACTIVE: 'secondary',
    SUSPENDED: 'destructive',
    REJECTED: 'destructive',
  };

interface ReassignTarget {
  id: string;
  name: string;
}

/** Institutes currently assigned to one reseller, with a per-row reassign action. */
export function ResellerInstitutesTab({ resellerId }: { resellerId: string }) {
  const t = useTranslations('adminResellers.institutes');
  const tStatus = useTranslations('adminInstitutes.statuses');
  const resolveI18n = useI18nField();
  const { format } = useFormatDate();
  const [target, setTarget] = React.useState<ReassignTarget | null>(null);

  const { data, loading, fetchMore } = useQuery(AdminResellerInstitutesDocument, {
    variables: { resellerId, first: PAGE_SIZE },
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });
  const connection = data?.adminListInstitutes;
  const institutes = connection?.edges.map((e) => e.node) ?? [];

  const loadMore = () => {
    const after = connection?.pageInfo.endCursor;
    if (!after) return;
    void fetchMore({ variables: { resellerId, first: PAGE_SIZE, after } });
  };

  if (loading && !connection) {
    return (
      <div className="space-y-2" data-testid={adminResellerDetail.institutesLoading}>
        {Array.from({ length: 5 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (institutes.length === 0) {
    return (
      <Empty className="py-12" data-testid={adminResellerDetail.institutesEmpty}>
        <EmptyHeader>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card data-testid={adminResellerDetail.institutesTab}>
      <CardHeader>
        <CardTitle>{t('title', { count: connection?.totalCount ?? 0 })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.code')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.created')}</TableHead>
              <TableHead className="text-end">{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {institutes.map((inst) => {
              const name = resolveI18n(inst.name) || '—';
              return (
                <TableRow key={inst.id} data-testid={adminResellerDetail.instituteRow(inst.id)}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/institutes/${inst.id}`}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {name}
                      <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{inst.code ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[inst.status]}>{tStatus(inst.status)}</Badge>
                  </TableCell>
                  <TableCell>{format(new Date(inst.createdAt), 'dd/MM/yyyy')}</TableCell>
                  <TableCell className="text-end">
                    <Can I="update" a="Institute">
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('reassignHint')}
                        onClick={() => setTarget({ id: inst.id, name })}
                        data-testid={adminResellerDetail.reassignBtn(inst.id)}
                      >
                        <ArrowRightLeft className="me-1 size-4" />
                        {t('reassign')}
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t('showing', { shown: institutes.length, total: connection?.totalCount ?? 0 })}
          </span>
          {connection?.pageInfo.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loading}
              data-testid={adminResellerDetail.institutesLoadMoreBtn}
            >
              {loading && <Loader2 className="me-2 size-4 animate-spin" />}
              {t('loadMore')}
            </Button>
          )}
        </div>
      </CardContent>
      <ReassignDialog resellerId={resellerId} target={target} onClose={() => setTarget(null)} />
    </Card>
  );
}

function ReassignDialog({
  resellerId,
  target,
  onClose,
}: {
  resellerId: string;
  target: ReassignTarget | null;
  onClose: () => void;
}) {
  const t = useTranslations('adminResellers.institutes');
  const errorMessage = useResellerErrorMessage();
  const [picked, setPicked] = React.useState<string | null>(null);
  const [reassign, { loading }] = useMutation(AdminResellerReassignInstituteDocument);

  React.useEffect(() => {
    if (target) setPicked(null);
  }, [target]);

  const confirm = async () => {
    if (!target || !picked) return;
    try {
      await reassign({
        variables: { id: target.id, newResellerId: picked },
        // AdminGetReseller keeps the header's institute count in step.
        refetchQueries: ['AdminResellerInstitutes', 'AdminGetReseller'],
        awaitRefetchQueries: true,
      });
      toast.success(t('reassignSuccess', { name: target.name }));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle data-testid={adminResellerDetail.reassignDialogTitle}>
            {t('reassignTitle', { name: target?.name ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('reassignDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel>{t('newReseller')}</FieldLabel>
          <ResellerCombobox
            value={picked}
            onChange={setPicked}
            required
            data-testid={adminResellerDetail.reassignSelect}
          />
        </Field>
        {picked === resellerId && (
          <p className="text-sm text-muted-foreground">{t('sameReseller')}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={adminResellerDetail.reassignCancelBtn}>
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
            disabled={loading || !picked || picked === resellerId}
            data-testid={adminResellerDetail.reassignConfirmBtn}
          >
            {loading && <Loader2 className="me-2 size-4 animate-spin" />}
            {t('reassignConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
