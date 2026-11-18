import type { SortOrder, TenantAnalyticsSortField } from '@roviq/graphql/generated';

export const TENANT_SORT_FIELDS = [
  'INSTITUTE_NAME',
  'ACTIVE_USERS_24H',
  'API_CALLS_24H',
] as const satisfies readonly TenantAnalyticsSortField[];

export const SORT_ORDERS = ['ASC', 'DESC'] as const satisfies readonly SortOrder[];

export interface TenantSort {
  field: TenantAnalyticsSortField;
  order: SortOrder;
}

/** Clicking the active column flips direction; a new column starts at its natural direction. */
export function nextTenantSort(current: TenantSort, clicked: TenantAnalyticsSortField): TenantSort {
  if (current.field === clicked) {
    return { field: clicked, order: current.order === 'ASC' ? 'DESC' : 'ASC' };
  }
  return { field: clicked, order: clicked === 'INSTITUTE_NAME' ? 'ASC' : 'DESC' };
}
