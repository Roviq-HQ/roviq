import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

/**
 * The unique constraint a failed write violated, or null for any other error. Drizzle wraps
 * the node-postgres error in DrizzleQueryError, so the SQLSTATE sits on `cause`, not on the
 * error itself.
 */
export function uniqueViolationConstraint(err: unknown): string | null {
  if (!(err instanceof DrizzleQueryError) || !(err.cause instanceof DatabaseError)) return null;
  return err.cause.code === '23505' ? (err.cause.constraint ?? null) : null;
}
