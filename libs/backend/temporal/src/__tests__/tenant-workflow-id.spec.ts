import { describe, expect, it } from 'vitest';
import { isTenantWorkflowId, tenantWorkflowId } from '../tenant-workflow-id';

const TENANT_A = '019a0000-0000-7000-8000-00000000000a';
const TENANT_B = '019a0000-0000-7000-8000-00000000000b';

describe('tenant workflow ids', () => {
  const id = tenantWorkflowId('bulk-student-import', TENANT_A, 'run-1');

  it('should build kind, institute and the unique part in that order', () => {
    expect(id).toBe(`bulk-student-import-${TENANT_A}-run-1`);
  });

  it('should accept the id for its own institute and kind', () => {
    expect(isTenantWorkflowId(id, 'bulk-student-import', TENANT_A)).toBe(true);
  });

  it('should refuse the id for another institute', () => {
    expect(isTenantWorkflowId(id, 'bulk-student-import', TENANT_B)).toBe(false);
  });

  it('should refuse the id for another kind of workflow', () => {
    expect(isTenantWorkflowId(id, 'compliance-export', TENANT_A)).toBe(false);
  });

  it('should refuse a bare prefix and an empty institute', () => {
    expect(
      isTenantWorkflowId(`bulk-student-import-${TENANT_A}-`, 'bulk-student-import', TENANT_A),
    ).toBe(false);
    expect(isTenantWorkflowId('bulk-student-import--x', 'bulk-student-import', '')).toBe(false);
  });
});
