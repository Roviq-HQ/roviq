import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

/** Builds a prefix tsquery from free text; punctuation would make to_tsquery throw. */
export function toPrefixTsQuery(term: string): string | null {
  const words = term
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0);
  return words.length > 0 ? words.map((w) => `${w}:*`).join(' & ') : null;
}

/**
 * Matches a name `search_vector` on the start of every typed word, so "Tan" finds "Tanvika".
 * Text with no letter or digit matches nothing.
 */
export function nameStartsWith(searchVector: AnyColumn | SQL, term: string): SQL {
  const tsQuery = toPrefixTsQuery(term);
  return tsQuery ? sql`${searchVector} @@ to_tsquery('simple', ${tsQuery})` : sql`false`;
}
