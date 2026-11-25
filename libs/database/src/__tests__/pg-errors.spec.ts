import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';
import { mapUniqueViolation, uniqueViolationConstraint } from '../pg-errors';

function queryError(code: string, constraint?: string): DrizzleQueryError {
  const cause = new DatabaseError('duplicate key value violates unique constraint', 0, 'error');
  cause.code = code;
  cause.constraint = constraint;
  return new DrizzleQueryError('insert into "t" values ($1)', ['x'], cause);
}

class NameTaken extends Error {}

describe('uniqueViolationConstraint', () => {
  it('names the constraint of a unique violation', () => {
    expect(uniqueViolationConstraint(queryError('23505', 't_name_key'))).toBe('t_name_key');
  });

  it('is null for another SQLSTATE or an error that is not a query error', () => {
    expect(uniqueViolationConstraint(queryError('23503', 't_fk'))).toBeNull();
    expect(uniqueViolationConstraint(new Error('t_name_key'))).toBeNull();
  });
});

describe('mapUniqueViolation', () => {
  const handler = mapUniqueViolation({ t_name_key: () => new NameTaken('taken') });

  it('throws the error built for a listed constraint', () => {
    expect(() => handler(queryError('23505', 't_name_key'))).toThrow(NameTaken);
  });

  it('rethrows a violation of a constraint that is not listed, unchanged', () => {
    const err = queryError('23505', 't_other_key');
    expect(() => handler(err)).toThrow(err);
  });

  it('rethrows any other failure unchanged', () => {
    const fk = queryError('23503', 't_name_key');
    expect(() => handler(fk)).toThrow(fk);
    const plain = new Error('boom');
    expect(() => handler(plain)).toThrow(plain);
  });

  it('does not treat an inherited property name as a listed constraint', () => {
    const err = queryError('23505', 'toString');
    expect(() => handler(err)).toThrow(err);
  });

  it('turns a rejected write into the mapped error when used as a catch handler', async () => {
    await expect(Promise.reject(queryError('23505', 't_name_key')).catch(handler)).rejects.toThrow(
      NameTaken,
    );
  });
});
