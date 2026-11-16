/**
 * CASL-to-SQL bridge using @ucast/sql (ROV-166).
 *
 * Converts CASL ability rules for a given action+subject into a Drizzle SQL
 * WHERE clause. Uses @ucast/sql (by the CASL author) to interpret CASL's
 * internal MongoDB-style conditions into parameterized PostgreSQL SQL.
 *
 * Pipeline:
 *   CASL ability → rulesToAST() → @ucast/core Condition → @ucast/sql → SQL + params → Drizzle sql
 */
import { rulesToAST } from '@casl/ability/extra';
import type { AppAbility, AppAction, AppSubject } from '@roviq/common-types';
import { allInterpreters, createSqlInterpreter, pg } from '@ucast/sql';
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

const within: typeof allInterpreters.in = (condition, query, context) =>
  condition.value.length === 0
    ? query.whereRaw('false')
    : allInterpreters.in(condition, query, context);
const nin: typeof allInterpreters.nin = (condition, query, context) =>
  condition.value.length === 0
    ? query.whereRaw('true')
    : allInterpreters.nin(condition, query, context);
const interpret = createSqlInterpreter({ ...allInterpreters, in: within, within, nin });

/** CASL condition field → Drizzle column (or column expression) it constrains. */
export type CaslColumnMap = Readonly<Record<string, AnyColumn | SQL>>;

// ⟪n⟫ marks a field slot; @ucast/sql never emits these brackets itself.
const FIELD_TOKEN = /\$(\d+)|⟪(\d+)⟫/g;

/**
 * Convert CASL ability rules for a given action+subject into a Drizzle SQL WHERE clause.
 *
 * Every condition field must map to a Drizzle column; a rule on an unmapped field
 * cannot be evaluated, so the whole predicate fails closed (`false`).
 *
 * @returns Drizzle SQL for `.where()`, or undefined when unrestricted (e.g. manage:all)
 */
export function caslToSqlWhere(
  ability: AppAbility,
  action: AppAction,
  subject: AppSubject,
  columns: CaslColumnMap,
): SQL | undefined {
  const ast = rulesToAST(ability, action, subject);
  if (ast === null) return sql`false`;
  if ('operator' in ast && ast.operator === 'and' && 'value' in ast) {
    const val = ast.value;
    if (Array.isArray(val) && val.length === 0) return undefined;
  }

  const fields: string[] = [];
  let unmapped = false;
  const [sqlString, params] = interpret(ast, {
    ...pg,
    escapeField: (field: string) => {
      if (!Object.hasOwn(columns, field)) unmapped = true;
      return `⟪${fields.push(field) - 1}⟫`;
    },
    joinRelation: () => false,
  });
  if (unmapped) return sql`false`;
  if (!sqlString || sqlString === '()') return undefined;

  const chunks: SQL[] = [];
  let last = 0;
  for (const match of sqlString.matchAll(FIELD_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) chunks.push(sql.raw(sqlString.slice(last, index)));
    chunks.push(
      match[1] !== undefined
        ? sql`${params[Number(match[1]) - 1]}`
        : sql`${columns[fields[Number(match[2])]]}`,
    );
    last = index + match[0].length;
  }
  if (last < sqlString.length) chunks.push(sql.raw(sqlString.slice(last)));
  return sql.join(chunks, sql``);
}
