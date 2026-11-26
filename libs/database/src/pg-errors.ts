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

/** The SQLSTATE of a failed query (`22003` for a number out of range), or null for any other error. */
export function pgErrorCode(err: unknown): string | null {
  if (!(err instanceof DrizzleQueryError) || !(err.cause instanceof DatabaseError)) return null;
  return err.cause.code ?? null;
}

/** For each unique constraint, the error a write that violates it is turned into. */
export type UniqueViolationErrors = Readonly<Record<string, () => Error>>;

/**
 * A `.catch()` handler that turns a violation of one of the named unique constraints into its
 * error and rethrows any other failure unchanged. The unique index is the only duplicate check
 * that holds when two saves run at once, so a pre-check alone never replaces this.
 */
export function mapUniqueViolation(errors: UniqueViolationErrors): (err: unknown) => never {
  return (err) => {
    const constraint = uniqueViolationConstraint(err);
    if (constraint !== null && Object.hasOwn(errors, constraint)) throw errors[constraint]();
    throw err;
  };
}
