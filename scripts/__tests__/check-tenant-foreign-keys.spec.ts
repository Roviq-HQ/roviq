import { foreignKey, pgTable, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  checkSetNullKeys,
  checkTenantKeys,
  EXCLUDED,
  LISTED,
  SET_NULL_KEYS_IN_CUSTOM_SQL,
  setNullStatement,
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

describe('checkSetNullKeys', () => {
  const silent = pgTable('silent', {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id'),
    parentId: uuid('parent_id'),
  });
  const key = { table: 'silent', column: 'parent_id', parent: 'parents' };
  const statement = `${setNullStatement(key)} ON UPDATE CASCADE;`;

  it('should pass when the schema declares no reference and a migration adds the key', () => {
    expect(checkSetNullKeys([parents, silent], statement, [key])).toEqual([]);
  });

  it('should report a key no migration adds', () => {
    expect(checkSetNullKeys([parents, silent], '', [key])).toHaveLength(1);
  });

  it('should report a key whose statement clears every column of the key', () => {
    const plain = statement.replace(' ("parent_id") ON UPDATE', ' ON UPDATE');
    expect(checkSetNullKeys([parents, silent], plain, [key])).toHaveLength(1);
  });

  it('should report a column the schema also gives a reference', () => {
    const declared = { table: 'children', column: 'plain_id', parent: 'parents' };
    const problems = checkSetNullKeys([parents, children], setNullStatement(declared), [declared]);
    expect(problems).toEqual([
      'children.plain_id -> parents: the schema declares a reference; the custom SQL key is the only one',
    ]);
  });

  it('should report a key a later migration drops, and an entry whose column is gone', () => {
    const dropped = `${statement}\nALTER TABLE "silent" DROP CONSTRAINT "silent_parent_id_tenant_fkey";`;
    expect(checkSetNullKeys([parents, silent], dropped, [key])).toHaveLength(1);
    expect(checkSetNullKeys([parents], statement, [key])).toEqual([
      'silent.parent_id -> parents: the column is not in the schema; remove the entry',
    ]);
  });
});

describe('the lists', () => {
  it('should name each key once', () => {
    expect(new Set(LISTED).size).toBe(LISTED.length);
    expect(LISTED).toHaveLength(Object.keys(EXCLUDED).length);
    const setNull = SET_NULL_KEYS_IN_CUSTOM_SQL.map((key) => `${key.table}.${key.column}`);
    expect(new Set(setNull).size).toBe(setNull.length);
  });

  it('should give a reason for every excluded key', () => {
    for (const reason of Object.values(EXCLUDED)) expect(reason.length).toBeGreaterThan(10);
  });
});
