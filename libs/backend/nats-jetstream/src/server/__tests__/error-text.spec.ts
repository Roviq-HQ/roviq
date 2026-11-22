import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';
import { deadLetterErrorText } from '../error-text';

describe('deadLetterErrorText', () => {
  it('should store the name and message of a plain error', () => {
    expect(deadLetterErrorText(new TypeError('bad input'))).toBe('TypeError: bad input');
  });

  it('should keep the outer name and take the message of the innermost cause', () => {
    const root = new Error('connection refused');
    const middle = new Error('lookup failed', { cause: root });
    const outer = new RangeError('handler failed', { cause: middle });

    expect(deadLetterErrorText(outer)).toBe('RangeError: connection refused');
  });

  it('should drop the query and parameters of a Drizzle-wrapped database error', () => {
    const pgError = new DatabaseError(
      'duplicate key value violates unique constraint "uq_x"',
      0,
      'error',
    );
    const wrapped = new DrizzleQueryError(
      'insert into "student_academics" ("tenant_id") values ($1)',
      ['0199aaaa-secret-tenant'],
      pgError,
    );

    const text = deadLetterErrorText(wrapped);

    expect(text).toBe('Error: duplicate key value violates unique constraint "uq_x"');
    expect(text).not.toContain('Failed query');
    expect(text).not.toContain('0199aaaa-secret-tenant');
  });

  it('should stop at a non-Error cause and use its text', () => {
    expect(deadLetterErrorText(new Error('outer', { cause: 'socket hang up' }))).toBe(
      'Error: socket hang up',
    );
  });

  it('should not loop on a cause cycle', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;

    expect(deadLetterErrorText(a)).toBe('Error: b');
  });

  it('should cut the text to 500 characters', () => {
    const text = deadLetterErrorText(new Error('x'.repeat(600)));

    expect(text).toBe(`Error: ${'x'.repeat(493)}`);
    expect(text).toHaveLength(500);
  });

  it('should describe non-Error values', () => {
    expect(deadLetterErrorText('plain string')).toBe('plain string');
    expect(deadLetterErrorText({ status: 'error', message: 'Internal server error' })).toBe(
      'Internal server error',
    );
    expect(deadLetterErrorText({ code: 42 })).toBe('{"code":42}');
    expect(deadLetterErrorText(undefined)).toBe('undefined');
  });
});
