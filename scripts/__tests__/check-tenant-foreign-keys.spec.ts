import { foreignKey, pgTable, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  checkTenantKeys,
  EXCLUDED,
  LISTED,
  NEEDS_SET_NULL_COLUMN_LIST,
  NOT_YET_CONVERTED,
  tenantKeysOf,
} from '../check-tenant-foreign-keys';

const parents = pgTable('parents', { id: uuid('id').primaryKey(), tenantId: uuid('tenant_id') });
const shared = pgTable('shared', { id: uuid('id').primaryKey() });
const children = pgTable(
  'children',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id'),
    plainId: uuid('plain_id').references(() => parents.id),
    scopedId: uuid('scoped_id'),
    sharedId: uuid('shared_id').references(() => shared.id),
  },
  (table) => [
    foreignKey({
      columns: [table.scopedId, table.tenantId],
      foreignColumns: [parents.id, parents.tenantId],
    }),
  ],
);

describe('tenantKeysOf', () => {
  it('should list keys between two tenant tables and say which carry tenant_id', () => {
    expect(tenantKeysOf([parents, shared, children])).toEqual([
      { name: 'children.plain_id -> parents', carriesTenant: false },
      { name: 'children.scoped_id -> parents', carriesTenant: true },
    ]);
  });
});

describe('checkTenantKeys', () => {
  const keys = tenantKeysOf([parents, shared, children]);

  it('should report a key without tenant_id that no list names', () => {
    expect(checkTenantKeys(keys, [])).toEqual({
      unlisted: ['children.plain_id -> parents'],
      stale: [],
    });
  });

  it('should pass when the key is listed', () => {
    expect(checkTenantKeys(keys, ['children.plain_id -> parents'])).toEqual({
      unlisted: [],
      stale: [],
    });
  });

  it('should report a listed key that already carries tenant_id or is gone', () => {
    expect(
      checkTenantKeys(keys, [
        'children.plain_id -> parents',
        'children.scoped_id -> parents',
        'children.removed_id -> parents',
      ]),
    ).toEqual({
      unlisted: [],
      stale: ['children.removed_id -> parents', 'children.scoped_id -> parents'],
    });
  });
});

describe('the lists', () => {
  it('should name each key once', () => {
    expect(new Set(LISTED).size).toBe(LISTED.length);
    expect(LISTED).toHaveLength(
      NOT_YET_CONVERTED.length + NEEDS_SET_NULL_COLUMN_LIST.length + Object.keys(EXCLUDED).length,
    );
  });
});
