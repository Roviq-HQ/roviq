import { describe, expect, it } from 'vitest';
import {
  type AuditFilterState,
  auditEntityHref,
  buildAuditLogFilter,
  CLEARED_AUDIT_FILTERS,
  hasActiveAuditFilters,
  isAuditDiff,
} from '../audit-utils';

const ENTITY_ID = '019a0000-0000-7000-8000-000000000001';

function filters(overrides: Partial<AuditFilterState>): AuditFilterState {
  return { ...CLEARED_AUDIT_FILTERS, ...overrides };
}

describe('buildAuditLogFilter', () => {
  it('returns undefined when nothing is set', () => {
    expect(buildAuditLogFilter(CLEARED_AUDIT_FILTERS)).toBeUndefined();
  });

  it('sends every selected action type', () => {
    expect(buildAuditLogFilter(filters({ actionType: ['DELETE', 'SUSPEND'] }))).toEqual({
      actionTypes: ['DELETE', 'SUSPEND'],
    });
  });

  it('maps both dates to one inclusive range covering the whole end day', () => {
    const from = new Date(2026, 0, 5).toISOString();
    const to = new Date(2026, 0, 7).toISOString();

    expect(buildAuditLogFilter(filters({ dateFrom: from, dateTo: to }))).toEqual({
      dateRange: { from, to: new Date(2026, 0, 7, 23, 59, 59, 999).toISOString() },
    });
  });

  it('fills the open side of a one-sided date range', () => {
    const from = new Date(2026, 0, 5).toISOString();

    expect(buildAuditLogFilter(filters({ dateFrom: from }))).toEqual({
      dateRange: { from, to: '9999-12-31T23:59:59.999Z' },
    });
  });

  it('keeps the tab preset alongside user filters', () => {
    expect(
      buildAuditLogFilter(filters({ entityType: 'Student', entityId: ENTITY_ID }), {
        scopes: ['reseller'],
      }),
    ).toEqual({ scopes: ['reseller'], entityType: 'Student', entityId: ENTITY_ID });
  });
});

describe('hasActiveAuditFilters', () => {
  it('treats an empty action type list as no filter', () => {
    expect(hasActiveAuditFilters(filters({ actionType: [] }))).toBe(false);
  });

  it('is true when any filter is set', () => {
    expect(hasActiveAuditFilters(filters({ actionType: ['DELETE'] }))).toBe(true);
  });
});

describe('auditEntityHref', () => {
  it('links an entity that has a detail page in this portal', () => {
    expect(auditEntityHref('institute', 'Student', ENTITY_ID)).toBe(
      `/institute/people/students/${ENTITY_ID}`,
    );
    expect(auditEntityHref('admin', 'Institute', ENTITY_ID)).toBe(`/admin/institutes/${ENTITY_ID}`);
  });

  it('returns null for an entity type without a detail page in this portal', () => {
    expect(auditEntityHref('admin', 'Student', ENTITY_ID)).toBeNull();
    expect(auditEntityHref('institute', 'Section', ENTITY_ID)).toBeNull();
  });

  it('returns null without an entity id', () => {
    expect(auditEntityHref('institute', 'Student', null)).toBeNull();
  });
});

describe('isAuditDiff', () => {
  it('accepts old/new pairs', () => {
    expect(isAuditDiff({ name: { old: 'Raj', new: 'Rajesh' } })).toBe(true);
  });

  it('rejects changes that are not old/new pairs', () => {
    expect(isAuditDiff({ name: 'Rajesh' })).toBe(false);
    expect(isAuditDiff({ name: null })).toBe(false);
  });
});
