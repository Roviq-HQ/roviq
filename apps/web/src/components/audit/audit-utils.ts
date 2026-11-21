import type { AuditLog, AuditLogFilterInput } from '@roviq/graphql/generated';
import { parseAsArrayOf, parseAsString } from 'nuqs';

/** Fields every portal's audit query returns, plus the ones only some return. */
export type AuditLogRow = Pick<
  AuditLog,
  | 'id'
  | 'userId'
  | 'actorId'
  | 'impersonatorId'
  | 'action'
  | 'actionType'
  | 'entityType'
  | 'entityId'
  | 'changes'
  | 'metadata'
  | 'correlationId'
  | 'ipAddress'
  | 'userAgent'
  | 'source'
  | 'createdAt'
  | 'actorName'
  | 'userName'
> &
  Partial<
    Pick<
      AuditLog,
      | 'scope'
      | 'tenantId'
      | 'tenantName'
      | 'resellerName'
      | 'resellerTier'
      | 'impersonationSessionId'
    >
  >;

export type AuditScope = 'admin' | 'reseller' | 'institute';

export const ACTION_TYPES = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'ASSIGN',
  'REVOKE',
  'SUSPEND',
  'ACTIVATE',
] as const;

const COMMON_ENTITY_TYPES = ['User', 'Role', 'Student', 'Section', 'Standard', 'Subject'] as const;

export const ENTITY_TYPES: Record<AuditScope, readonly string[]> = {
  admin: [...COMMON_ENTITY_TYPES, 'Timetable', 'Attendance'],
  reseller: [...COMMON_ENTITY_TYPES, 'Membership', 'Institute'],
  institute: [...COMMON_ENTITY_TYPES, 'Timetable', 'Attendance', 'Membership'],
};

export const TIER_BADGE_CLASS: Record<string, string> = {
  FULL_MANAGEMENT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  SUPPORT_MANAGEMENT: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  READ_ONLY: 'bg-muted text-muted-foreground',
};

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const auditFilterParsers = {
  entityType: parseAsString,
  actionType: parseAsArrayOf(parseAsString),
  userId: parseAsString,
  entityId: parseAsString,
  tenantId: parseAsString,
  dateFrom: parseAsString,
  dateTo: parseAsString,
};

export interface AuditFilterState {
  entityType: string | null;
  actionType: string[] | null;
  userId: string | null;
  entityId: string | null;
  tenantId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

export const CLEARED_AUDIT_FILTERS: AuditFilterState = {
  entityType: null,
  actionType: null,
  userId: null,
  entityId: null,
  tenantId: null,
  dateFrom: null,
  dateTo: null,
};

export function hasActiveAuditFilters(filters: AuditFilterState): boolean {
  return Object.values(filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  );
}

const RANGE_START = '1970-01-01T00:00:00.000Z';
const RANGE_END = '9999-12-31T23:59:59.999Z';
const DAY_MS = 86_400_000;

/** Maps URL filter state to the API filter. `preset` carries tab-level constraints. */
export function buildAuditLogFilter(
  filters: AuditFilterState,
  preset: AuditLogFilterInput = {},
): AuditLogFilterInput | undefined {
  const filter: AuditLogFilterInput = { ...preset };
  if (filters.entityType) filter.entityType = filters.entityType;
  if (filters.actionType && filters.actionType.length > 0) filter.actionTypes = filters.actionType;
  if (filters.userId) filter.userId = filters.userId;
  if (filters.entityId) filter.entityId = filters.entityId;
  if (filters.tenantId) filter.tenantId = filters.tenantId;
  if (filters.dateFrom || filters.dateTo) {
    // The API takes one closed range, so an open side gets a sentinel bound.
    // `dateTo` is the picked day's midnight; extend it to cover that whole day.
    filter.dateRange = {
      from: filters.dateFrom ?? RANGE_START,
      to: filters.dateTo
        ? new Date(new Date(filters.dateTo).getTime() + DAY_MS - 1).toISOString()
        : RANGE_END,
    };
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export function getImpersonatorScope(log: AuditLogRow): 'platform' | 'reseller' | 'institute' {
  const scope = log.metadata?.impersonator_scope;
  if (scope === 'platform' || scope === 'reseller') return scope;
  return 'institute';
}

/** Entity types (as the audit interceptor names them) that have a detail page, per portal. */
const ENTITY_ROUTES: Record<AuditScope, Record<string, string>> = {
  admin: {
    Institute: '/admin/institutes',
    InstituteGroup: '/admin/institute-groups',
    Reseller: '/admin/resellers',
  },
  reseller: {
    Institute: '/reseller/institutes',
  },
  institute: {
    Student: '/institute/people/students',
    StaffMember: '/institute/people/staff',
    Guardian: '/institute/people/guardians',
    Group: '/institute/groups',
    Standard: '/institute/academics',
    Holiday: '/institute/holiday',
    Leave: '/institute/leave',
    Timetable: '/institute/timetable',
    Exam: '/institute/examinations',
  },
};

export function auditEntityHref(
  scope: AuditScope,
  entityType: string,
  entityId: string | null,
): string | null {
  const base = ENTITY_ROUTES[scope][entityType];
  return base && entityId ? `${base}/${entityId}` : null;
}

export type AuditDiff = Record<string, { old: unknown; new: unknown }>;

/** True when every entry is an `{ old, new }` pair — what the diff table can render. */
export function isAuditDiff(changes: Record<string, unknown>): changes is AuditDiff {
  return Object.values(changes).every(
    (value) => typeof value === 'object' && value !== null && ('old' in value || 'new' in value),
  );
}

export function hasAuditChanges(log: AuditLogRow): boolean {
  return log.changes != null && Object.keys(log.changes).length > 0;
}
