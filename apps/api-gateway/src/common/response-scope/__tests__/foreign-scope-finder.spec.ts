import { describe, expect, it } from 'vitest';
import { findForeignScope } from '../foreign-scope-finder';

const OWN = '019b0000-0000-7000-8000-0000000000aa';
const OTHER = '019b0000-0000-7000-8000-0000000000bb';

describe('findForeignScope', () => {
  it('should pass a result whose rows all carry the caller institute', () => {
    const result = findForeignScope(
      { edges: [{ node: { id: '1', tenantId: OWN } }, { node: { id: '2', tenant_id: OWN } }] },
      { tenantId: OWN },
    );
    expect(result).toEqual({ foreign: null, truncated: false });
  });

  it('should find another institute id nested in a list', () => {
    const result = findForeignScope(
      { edges: [{ node: { tenantId: OWN } }, { node: { guardian: { tenantId: OTHER } } }] },
      { tenantId: OWN },
    );
    expect(result.foreign).toEqual({ kind: 'tenantId', found: OTHER });
  });

  it('should find a snake_case column as well', () => {
    const result = findForeignScope([{ tenant_id: OTHER }], { tenantId: OWN });
    expect(result.foreign).toEqual({ kind: 'tenantId', found: OTHER });
  });

  it('should compare ids without regard to letter case', () => {
    const result = findForeignScope({ tenantId: OWN.toUpperCase() }, { tenantId: OWN });
    expect(result.foreign).toBeNull();
  });

  it('should not treat a null or missing institute id as foreign', () => {
    const result = findForeignScope([{ tenantId: null }, { id: 'x' }], { tenantId: OWN });
    expect(result.foreign).toBeNull();
  });

  it('should compare only the kinds the caller has', () => {
    const row = { tenantId: OTHER, resellerId: OTHER };
    expect(findForeignScope(row, { resellerId: OWN }).foreign).toEqual({
      kind: 'resellerId',
      found: OTHER,
    });
    expect(findForeignScope({ tenantId: OTHER }, { resellerId: OWN }).foreign).toBeNull();
  });

  it('should skip values that are not data', () => {
    const result = findForeignScope(
      { at: new Date(), bytes: Buffer.from('x'), map: new Map([['tenantId', OTHER]]) },
      { tenantId: OWN },
    );
    expect(result).toEqual({ foreign: null, truncated: false });
    expect(findForeignScope('text', { tenantId: OWN }).foreign).toBeNull();
    expect(findForeignScope(null, { tenantId: OWN }).foreign).toBeNull();
  });

  it('should survive a result that refers to itself', () => {
    const row: Record<string, unknown> = { tenantId: OWN };
    row.self = row;
    expect(findForeignScope(row, { tenantId: OWN })).toEqual({ foreign: null, truncated: false });
  });

  it('should find a foreign id however deep it sits', () => {
    let value: Record<string, unknown> = { tenantId: OTHER };
    for (let level = 0; level < 500; level += 1) value = { child: [value] };
    expect(findForeignScope(value, { tenantId: OWN }).foreign).toEqual({
      kind: 'tenantId',
      found: OTHER,
    });
  });

  it('should report a value with more objects than the limit as not fully read', () => {
    const rows = Array.from({ length: 50 }, () => ({ tenantId: OWN }));
    expect(findForeignScope(rows, { tenantId: OWN }, 10)).toEqual({
      foreign: null,
      truncated: true,
    });
  });

  it('should read a value exactly at the limit in full', () => {
    const rows = Array.from({ length: 9 }, () => ({ tenantId: OWN }));
    expect(findForeignScope(rows, { tenantId: OWN }, 10)).toEqual({
      foreign: null,
      truncated: false,
    });
  });
});
