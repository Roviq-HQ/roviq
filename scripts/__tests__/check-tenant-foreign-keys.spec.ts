import { foreignKey, pgTable, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  checkSetNullKeys,
  checkTenantKeys,
  orNoneKeyName,
  orNoneStatements,
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

/** Rows of `optional` may belong to no institute; rows of `strict` always belong to one. */
const strict = pgTable('strict', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
});
const optional = pgTable('optional', { id: uuid('id').primaryKey(), tenantId: uuid('tenant_id') });

const referencing = (name: string | undefined, parent: typeof strict | typeof optional) =>
  pgTable(
    'referencing',
    { id: uuid('id').primaryKey(), tenantId: uuid('tenant_id').notNull(), refId: uuid('ref_id') },
    (table) => [foreignKey({ name, columns: [table.refId], foreignColumns: [parent.id] })],
  );

describe('tenantKeysOf', () => {
  it('should list keys between two tenant tables and say which carry tenant_id', () => {
    expect(
      tenantKeysOf([parents, shared, children]).map(({ name, carriesTenant }) => ({
        name,
        carriesTenant,
      })),
    ).toEqual([
      { name: 'children.plain_id -> parents', carriesTenant: false },
      { name: 'children.scoped_id -> parents', carriesTenant: true },
    ]);
  });

  it('should say whether the referenced table may hold rows of no institute', () => {
    const [toStrict] = tenantKeysOf([strict, referencing(undefined, strict)]);
    const [toOptional] = tenantKeysOf([optional, referencing(undefined, optional)]);
    expect(toStrict).toMatchObject({ parent: 'strict', parentTenantOptional: false });
    expect(toOptional).toMatchObject({
      table: 'referencing',
      column: 'ref_id',
      parent: 'optional',
      parentTenantOptional: true,
    });
  });
});

describe('checkTenantKeys', () => {
  const key = { table: 'referencing', column: 'ref_id', parent: 'optional' };
  const declared = tenantKeysOf([optional, referencing(orNoneKeyName(key), optional)]);
  const statements = orNoneStatements(key).join('\n');

  it('should pass a key that carries tenant_id', () => {
    const carrying = tenantKeysOf([parents, shared, children]).filter((k) => k.carriesTenant);
    expect(checkTenantKeys(carrying, '')).toEqual([]);
  });

  it('should pass a one-column key declared with the helper when a migration adds both triggers', () => {
    expect(checkTenantKeys(declared, statements)).toEqual([]);
  });

  it('should refuse a one-column key to a table whose rows always belong to an institute', () => {
    const keys = tenantKeysOf([strict, referencing(orNoneKeyName(key), strict)]);
    const problems = checkTenantKeys(keys, statements);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('sameTenantForeignKey()');
  });

  it('should refuse a one-column key that was not declared with the helper', () => {
    const keys = tenantKeysOf([optional, referencing(undefined, optional)]);
    const problems = checkTenantKeys(keys, statements);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('sameTenantOrNoneForeignKey(');
  });

  it('should report each trigger no migration adds', () => {
    const [onReferencing, onReferenced] = orNoneStatements(key);
    expect(checkTenantKeys(declared, '')).toHaveLength(2);
    expect(checkTenantKeys(declared, onReferencing)).toEqual([
      `referencing.ref_id -> optional: no migration holds\n      ${onReferenced}`,
    ]);
    expect(checkTenantKeys(declared, onReferenced)).toEqual([
      `referencing.ref_id -> optional: no migration holds\n      ${onReferencing}`,
    ]);
  });

  it('should report a trigger a later migration drops', () => {
    for (const dropped of [
      'DROP TRIGGER "referencing_ref_id_tenant_or_none" ON "referencing";',
      'DROP TRIGGER IF EXISTS optional_keep_referenced_tenant ON optional;',
    ]) {
      expect(checkTenantKeys(declared, `${statements}\n${dropped}`)).toHaveLength(1);
    }
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
  it('should name each SET NULL key once', () => {
    const setNull = SET_NULL_KEYS_IN_CUSTOM_SQL.map((key) => `${key.table}.${key.column}`);
    expect(new Set(setNull).size).toBe(setNull.length);
  });
});
