import { describe, expect, it } from 'vitest';
import { nextTenantSort } from '../_lib/tenant-sort';

describe('nextTenantSort', () => {
  it('should flip the direction when the active column is clicked', () => {
    expect(nextTenantSort({ field: 'API_CALLS_24H', order: 'DESC' }, 'API_CALLS_24H')).toEqual({
      field: 'API_CALLS_24H',
      order: 'ASC',
    });
    expect(nextTenantSort({ field: 'API_CALLS_24H', order: 'ASC' }, 'API_CALLS_24H')).toEqual({
      field: 'API_CALLS_24H',
      order: 'DESC',
    });
  });

  it('should start the institute name column A→Z', () => {
    expect(nextTenantSort({ field: 'API_CALLS_24H', order: 'DESC' }, 'INSTITUTE_NAME')).toEqual({
      field: 'INSTITUTE_NAME',
      order: 'ASC',
    });
  });

  it('should start numeric columns highest first', () => {
    expect(nextTenantSort({ field: 'INSTITUTE_NAME', order: 'ASC' }, 'ACTIVE_USERS_24H')).toEqual({
      field: 'ACTIVE_USERS_24H',
      order: 'DESC',
    });
  });
});
