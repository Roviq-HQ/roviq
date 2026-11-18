'use client';

import { RESELLER_TIER_VALUES } from '@roviq/common-types';
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
  Field,
  FieldDescription,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useBreadcrumbOverride,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import * as React from 'react';
import { toast } from 'sonner';
import { STATUS_CLASS, STATUS_VARIANT, TIER_CLASS } from '../reseller-badge-styles';
import type { ResellerNode, ResellerTier } from '../types';
import { useResellerErrorMessage } from '../use-reseller-error-message';
import {
  useChangeResellerTier,
  useDeleteReseller,
  useReseller,
  useSuspendReseller,
  useUnsuspendReseller,
} from '../use-resellers';
import { ResellerActivityTab } from './_components/activity-tab';
import { ResellerBillingTab } from './_components/billing-tab';
import { EditResellerDialog } from './_components/edit-reseller-dialog';
import { ResellerInstitutesTab } from './_components/institutes-tab';
import { ResellerOverview } from './_components/overview-tab';
import { type DialogType, ResellerActions } from './_components/reseller-actions';
import { ResellerTeamTab } from './_components/team-tab';

const { adminResellerDetail } = testIds;
// ─── Dialog type ─────────────────────────────────────────────────────────────

const TAB_VALUES = ['overview', 'institutes', 'team', 'activity', 'billing'] as const;

// ─── Change Tier Dialog ────────────────────────────────────────────────────────

function ChangeTierDialog({
  reseller,
  open,
  onClose,
}: {
  reseller: ResellerNode;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('adminResellers');
  const errorMessage = useResellerErrorMessage();
  const [changeTier] = useChangeResellerTier();
  const [newTier, setNewTier] = React.useState<ResellerTier>(reseller.tier);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset to the current server tier whenever the dialog opens so a re-open
  // after an external tier change doesn't present a stale selection.
  React.useEffect(() => {
    if (open) setNewTier(reseller.tier);
  }, [open, reseller.tier]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      // AdminResellerTeam: every staff member's role follows the new tier.
      await changeTier({
        variables: { id: reseller.id, newTier },
        refetchQueries: ['AdminResellerTeam'],
      });
      toast.success(t('actions.tierSuccess'));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle data-testid={adminResellerDetail.changeTierDialogTitle}>
            {t('actions.changeTierTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('actions.changeTierDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel>{t('actions.newTier')}</FieldLabel>
          <Select value={newTier} onValueChange={(v) => setNewTier(v as ResellerTier)}>
            <SelectTrigger data-testid={adminResellerDetail.changeTierSelect}>
              <SelectValue placeholder={t('actions.newTierPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {RESELLER_TIER_VALUES.map((tier) => (
                <SelectItem key={tier} value={tier} data-testid={`tier-option-${tier}`}>
                  {t(`tiers.${tier}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t(`tierDescriptions.${newTier}`)}</FieldDescription>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={adminResellerDetail.changeTierCancelBtn}>
            {t('actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={submitting || newTier === reseller.tier}
            data-testid={adminResellerDetail.changeTierConfirmBtn}
          >
            {submitting ? (
              <>
                <Loader2 className="me-2 size-4 animate-spin" />
                {t('actions.saving')}
              </>
            ) : (
              t('actions.confirm')
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Detail Page ──────────────────────────────────────────────────────────────

export default function ResellerDetailPage() {
  const t = useTranslations('adminResellers');
  const errorMessage = useResellerErrorMessage();
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : '';

  const [activeTab, setActiveTab] = useQueryState(
    'tab',
    parseAsStringLiteral(TAB_VALUES).withDefault('overview'),
  );
  const [dialog, setDialog] = React.useState<DialogType>(null);
  const [suspendReason, setSuspendReason] = React.useState('');
  const [actionSubmitting, setActionSubmitting] = React.useState(false);

  const { data, loading, refetch } = useReseller(id);
  const reseller = data?.adminGetReseller;

  const [suspendReseller] = useSuspendReseller();
  const [unsuspendReseller] = useUnsuspendReseller();
  const [deleteReseller] = useDeleteReseller();

  useBreadcrumbOverride(reseller ? { [id]: reseller.name } : {});

  const handleSuspend = async () => {
    if (!reseller) return;
    setActionSubmitting(true);
    try {
      await suspendReseller({
        variables: { resellerId: reseller.id, ...(suspendReason ? { reason: suspendReason } : {}) },
      });
      toast.success(t('actions.suspendSuccess'));
      setDialog(null);
      setSuspendReason('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleUnsuspend = async () => {
    if (!reseller) return;
    setActionSubmitting(true);
    try {
      await unsuspendReseller({ variables: { resellerId: reseller.id } });
      toast.success(t('actions.unsuspendSuccess'));
      setDialog(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!reseller) return;
    setActionSubmitting(true);
    try {
      await deleteReseller({ variables: { resellerId: reseller.id } });
      toast.success(t('actions.deleteSuccess'));
      router.push('/admin/resellers');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setActionSubmitting(false);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading && !reseller) {
    return (
      <div className="space-y-4" data-testid={adminResellerDetail.loading}>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!reseller) {
    return (
      <div className="py-16 text-center" data-testid={adminResellerDetail.notFound}>
        <p className="text-muted-foreground">{t('detail.notFound')}</p>
      </div>
    );
  }

  // ── Page ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid={adminResellerDetail.page}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1
              className="text-2xl font-bold tracking-tight"
              data-testid={adminResellerDetail.title}
            >
              {reseller.name}
            </h1>
            <Badge
              variant={STATUS_VARIANT[reseller.status]}
              className={STATUS_CLASS[reseller.status]}
              data-testid={adminResellerDetail.statusBadge}
            >
              {t(`statuses.${reseller.status}`)}
            </Badge>
            <Badge
              variant="secondary"
              className={TIER_CLASS[reseller.tier]}
              data-testid={adminResellerDetail.tierBadge}
            >
              {t(`tiers.${reseller.tier}`)}
            </Badge>
            {reseller.isSystem && (
              <Badge variant="outline" data-testid={adminResellerDetail.systemBadge}>
                {t('detail.systemBadge')}
              </Badge>
            )}
          </div>
          <p className="font-mono text-sm text-muted-foreground">{reseller.slug}</p>
        </div>

        <ResellerActions reseller={reseller} onOpen={setDialog} />
      </div>

      {reseller.isSystem && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          data-testid={adminResellerDetail.systemNotice}
        >
          {t('detail.systemNote')}
        </div>
      )}

      {/* Tabs — shadcn Tabs passes the raw value string; parseAsStringLiteral
          guarantees on read that it's one of TAB_VALUES, so we only need to
          forward the string untouched and let the setter reject unknowns. */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          if ((TAB_VALUES as readonly string[]).includes(v)) {
            setActiveTab(v as (typeof TAB_VALUES)[number]);
          }
        }}
      >
        <TabsList>
          <TabsTrigger value="overview" data-testid={adminResellerDetail.tab('overview')}>
            {t('detail.tabs.overview')}
          </TabsTrigger>
          <TabsTrigger value="institutes" data-testid={adminResellerDetail.tab('institutes')}>
            {t('detail.tabs.institutes')}
          </TabsTrigger>
          <TabsTrigger value="team" data-testid={adminResellerDetail.tab('team')}>
            {t('detail.tabs.team')}
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid={adminResellerDetail.tab('activity')}>
            {t('detail.tabs.activity')}
          </TabsTrigger>
          <TabsTrigger value="billing" data-testid={adminResellerDetail.tab('billing')}>
            {t('detail.tabs.billing')}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent
          value="overview"
          className="mt-4 space-y-4"
          data-testid={adminResellerDetail.tabContent('overview')}
        >
          <ResellerOverview reseller={reseller} />
        </TabsContent>

        <TabsContent
          value="institutes"
          className="mt-4"
          data-testid={adminResellerDetail.tabContent('institutes')}
        >
          {activeTab === 'institutes' && <ResellerInstitutesTab resellerId={reseller.id} />}
        </TabsContent>

        <TabsContent
          value="team"
          className="mt-4"
          data-testid={adminResellerDetail.tabContent('team')}
        >
          {activeTab === 'team' && <ResellerTeamTab resellerId={reseller.id} />}
        </TabsContent>

        <TabsContent
          value="activity"
          className="mt-4"
          data-testid={adminResellerDetail.tabContent('activity')}
        >
          {activeTab === 'activity' && <ResellerActivityTab resellerId={reseller.id} />}
        </TabsContent>

        <TabsContent
          value="billing"
          className="mt-4"
          data-testid={adminResellerDetail.tabContent('billing')}
        >
          {activeTab === 'billing' && <ResellerBillingTab resellerId={reseller.id} />}
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      {/* Edit dialog */}
      <EditResellerDialog
        reseller={reseller}
        open={dialog === 'edit'}
        onClose={() => setDialog(null)}
        onStale={() => void refetch()}
      />

      {/* Change Tier dialog */}
      <ChangeTierDialog
        reseller={reseller}
        open={dialog === 'changeTier'}
        onClose={() => setDialog(null)}
      />

      {/* Suspend dialog */}
      <AlertDialog
        open={dialog === 'suspend'}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setSuspendReason('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid={adminResellerDetail.suspendDialogTitle}>
              {t('actions.suspendTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('actions.suspendDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel>{t('actions.suspendReason')}</FieldLabel>
            <Textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder={t('actions.suspendReasonPlaceholder')}
              rows={3}
              data-testid={adminResellerDetail.suspendReasonInput}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid={adminResellerDetail.suspendCancelBtn}
              onClick={() => {
                setDialog(null);
                setSuspendReason('');
              }}
            >
              {t('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSuspend}
              disabled={actionSubmitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={adminResellerDetail.suspendConfirmBtn}
            >
              {actionSubmitting ? <Loader2 className="me-2 size-4 animate-spin" /> : null}
              {t('actions.suspendConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsuspend dialog */}
      <AlertDialog open={dialog === 'unsuspend'} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid={adminResellerDetail.unsuspendDialogTitle}>
              {t('actions.unsuspendTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('actions.unsuspendDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={adminResellerDetail.unsuspendCancelBtn}>
              {t('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnsuspend}
              disabled={actionSubmitting}
              data-testid={adminResellerDetail.unsuspendConfirmBtn}
            >
              {actionSubmitting ? <Loader2 className="me-2 size-4 animate-spin" /> : null}
              {t('actions.unsuspendConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete dialog */}
      <AlertDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid={adminResellerDetail.deleteDialogTitle}>
              {t('actions.deleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('actions.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <p
            className="text-sm text-muted-foreground"
            data-testid={adminResellerDetail.deleteGracePeriodNote}
          >
            {t('actions.deleteGracePeriod')}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={adminResellerDetail.deleteCancelBtn}>
              {t('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={actionSubmitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={adminResellerDetail.deleteConfirmBtn}
            >
              {actionSubmitting ? <Loader2 className="me-2 size-4 animate-spin" /> : null}
              {t('actions.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
