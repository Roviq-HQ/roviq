/**
 * ROV-145 — unit test for the audit-log column factory's reseller columns.
 *
 * The Reseller Activity tab passes `showReseller = true` to surface the resolved
 * reseller name + tier badge; other tabs must not include those columns.
 */
import type { ColumnDef } from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';
import { createAuditLogColumns } from '../audit-log-columns';
import type { AuditLogNode } from '../use-audit-logs';

const t = (key: string) => key;
const formatDate = (date: Date) => date.toISOString();

function accessorKeys(cols: ColumnDef<AuditLogNode, unknown>[]): string[] {
  return cols.flatMap((c) => ('accessorKey' in c && c.accessorKey ? [String(c.accessorKey)] : []));
}

describe('createAuditLogColumns', () => {
  it('omits reseller columns by default', () => {
    const keys = accessorKeys(createAuditLogColumns(t, formatDate));

    expect(keys).not.toContain('resellerName');
    expect(keys).not.toContain('resellerTier');
  });

  it('adds reseller name + tier columns when showReseller is true', () => {
    const keys = accessorKeys(createAuditLogColumns(t, formatDate, true));

    expect(keys).toContain('resellerName');
    expect(keys).toContain('resellerTier');
  });
});
