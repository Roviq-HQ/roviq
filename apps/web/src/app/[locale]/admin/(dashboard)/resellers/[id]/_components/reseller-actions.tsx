'use client';

import { Button, Can } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Edit2, Layers, ShieldOff, Trash2, Undo } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ResellerNode } from '../../types';

const { adminResellerDetail } = testIds;

export type DialogType = 'edit' | 'changeTier' | 'suspend' | 'unsuspend' | 'delete' | null;

/** Mirrors the server's 30-day suspension grace period before deletion. */
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** Header actions. Roviq Direct shows them disabled with the reason as hover text. */
export function ResellerActions({
  reseller,
  onOpen,
}: {
  reseller: ResellerNode;
  onOpen: (dialog: DialogType) => void;
}) {
  const t = useTranslations('adminResellers');
  const graceElapsed =
    !!reseller.suspendedAt &&
    Date.now() - new Date(reseller.suspendedAt).getTime() >= GRACE_PERIOD_MS;
  const tierTitle = reseller.isSystem
    ? t('detail.systemLocked')
    : reseller.status === 'ACTIVE'
      ? t('actions.changeTierDescription')
      : t('detail.tierNeedsActive');
  const deleteTitle = reseller.isSystem
    ? t('detail.systemLocked')
    : graceElapsed
      ? t('actions.deleteDescription')
      : t('actions.deleteGracePeriod');

  return (
    <div className="flex shrink-0 flex-wrap gap-2" data-testid={adminResellerDetail.actions}>
      <Can I="update" a="Reseller">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpen('edit')}
          disabled={reseller.isSystem || reseller.status === 'DELETED'}
          title={reseller.isSystem ? t('detail.systemLocked') : t('actions.editDescription')}
          data-testid={adminResellerDetail.actionEditBtn}
        >
          <Edit2 className="me-1 size-4" />
          {t('actions.edit')}
        </Button>
      </Can>

      {reseller.status !== 'DELETED' && (
        <Can I="update" a="Reseller">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpen('changeTier')}
            disabled={reseller.isSystem || reseller.status !== 'ACTIVE'}
            title={tierTitle}
            data-testid={adminResellerDetail.actionChangeTierBtn}
          >
            <Layers className="me-1 size-4" />
            {t('actions.changeTier')}
          </Button>
        </Can>
      )}

      {(reseller.isSystem || reseller.status === 'ACTIVE') && (
        <Can I="suspend" a="Reseller">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpen('suspend')}
            disabled={reseller.isSystem}
            title={reseller.isSystem ? t('detail.systemLocked') : t('actions.suspendDescription')}
            data-testid={adminResellerDetail.actionSuspendBtn}
          >
            <ShieldOff className="me-1 size-4" />
            {t('actions.suspend')}
          </Button>
        </Can>
      )}

      {reseller.status === 'SUSPENDED' && (
        <Can I="update" a="Reseller">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpen('unsuspend')}
            title={t('actions.unsuspendDescription')}
            data-testid={adminResellerDetail.actionUnsuspendBtn}
          >
            <Undo className="me-1 size-4" />
            {t('actions.unsuspend')}
          </Button>
        </Can>
      )}

      {(reseller.isSystem || reseller.status === 'SUSPENDED') && (
        <Can I="delete" a="Reseller">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen('delete')}
            disabled={reseller.isSystem || !graceElapsed}
            title={deleteTitle}
            className="text-destructive hover:text-destructive"
            data-testid={adminResellerDetail.actionDeleteBtn}
          >
            <Trash2 className="me-1 size-4" />
            {t('actions.delete')}
          </Button>
        </Can>
      )}
    </div>
  );
}
