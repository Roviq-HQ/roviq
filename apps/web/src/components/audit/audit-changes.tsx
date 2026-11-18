'use client';

import { AuditDiffRenderer } from '@roviq/ui';
import { useTranslations } from 'next-intl';
import { type AuditLogRow, hasAuditChanges, isAuditDiff } from './audit-utils';
import { useAuditLabels } from './use-audit-labels';

export function JsonBlock({
  data,
  emptyMessage,
}: {
  data: Record<string, unknown> | null | undefined;
  emptyMessage: string;
}) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="mt-1.5 rounded-lg border border-dashed border-border/50 px-3 py-3">
        <span className="text-xs italic text-muted-foreground/50">{emptyMessage}</span>
      </div>
    );
  }

  return (
    <pre className="mt-1.5 max-h-[240px] overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground/80">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

/** Old → new diff of an audit entry; raw JSON when the changes are not `{ old, new }` pairs. */
export function AuditChanges({ log }: { log: AuditLogRow }) {
  const t = useTranslations('auditLogs');
  const labels = useAuditLabels();

  if (hasAuditChanges(log) && log.changes && isAuditDiff(log.changes)) {
    return (
      <AuditDiffRenderer changes={log.changes} actionType={log.actionType} labels={labels.diff} />
    );
  }
  return <JsonBlock data={log.changes} emptyMessage={t('detail.noChanges')} />;
}
