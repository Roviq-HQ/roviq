import { describe, expect, it } from 'vitest';
import { alertRecipients, isSubset, planLoad } from '../lib/observability';

const WANTED = {
  name: 'dlq_messages_warning',
  enabled: true,
  query_condition: { type: 'promql', promql_condition: { operator: '>', value: 0.016667 } },
  destinations: ['roviq_ops_email'],
};

describe('isSubset', () => {
  it('should accept a stored object that adds defaults and bookkeeping fields', () => {
    const stored = {
      ...WANTED,
      id: 'abc',
      owner: 'ops@example.com',
      query_condition: {
        type: 'promql',
        sql: null,
        promql_condition: { operator: '>', value: 0.016667, ignore_case: false },
      },
    };

    expect(isSubset(WANTED, stored)).toBe(true);
  });

  it('should reject a stored object whose nested value differs', () => {
    const stored = {
      ...WANTED,
      query_condition: { type: 'promql', promql_condition: { operator: '>', value: 0.5 } },
    };

    expect(isSubset(WANTED, stored)).toBe(false);
  });

  it('should reject a stored array with an extra item', () => {
    const stored = { ...WANTED, destinations: ['roviq_ops_email', 'other'] };

    expect(isSubset(WANTED, stored)).toBe(false);
  });

  it('should reject a stored object that lacks a wanted key', () => {
    expect(isSubset(WANTED, { name: 'dlq_messages_warning' })).toBe(false);
  });

  it('should reject a scalar where an object is wanted', () => {
    expect(isSubset({ a: { b: 1 } }, { a: 1 })).toBe(false);
  });
});

describe('planLoad', () => {
  it('should create an object OpenObserve does not hold', () => {
    expect(planLoad(WANTED, undefined)).toBe('created');
  });

  it('should leave a matching object unchanged', () => {
    expect(planLoad(WANTED, { ...WANTED, id: 'abc' })).toBe('unchanged');
  });

  it('should update an object that differs from its file', () => {
    expect(planLoad(WANTED, { ...WANTED, enabled: false })).toBe('updated');
  });
});

describe('alertRecipients', () => {
  it('should fall back to the loader user when no recipient is configured', () => {
    expect(alertRecipients(undefined, 'ops@example.com')).toEqual(['ops@example.com']);
    expect(alertRecipients(' , ', 'ops@example.com')).toEqual(['ops@example.com']);
  });

  it('should split and trim a comma-separated list', () => {
    expect(alertRecipients('a@example.com, b@example.com', 'ops@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });
});
