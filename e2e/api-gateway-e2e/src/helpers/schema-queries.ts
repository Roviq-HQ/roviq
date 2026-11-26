/**
 * Builds one GraphQL document for every field of `Query`, read from the running gateway by
 * introspection. Used by `two-institute.api-e2e.spec.ts`.
 */
import { randomUUID } from 'node:crypto';
import {
  buildClientSchema,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputObjectType,
  type GraphQLInputType,
  type GraphQLOutputType,
  type GraphQLSchema,
  getIntrospectionQuery,
  getNamedType,
  type IntrospectionQuery,
  isAbstractType,
  isEnumType,
  isInputObjectType,
  isLeafType,
  isListType,
  isNonNullType,
  isObjectType,
} from 'graphql';
import { gql } from './gql-client';

export type QueryField = GraphQLField<unknown, unknown>;

/** Whose ids fill the id arguments: the caller's own institute, or another one. */
export type IdSource = 'own' | 'foreign';

export interface ArgumentTables<Kind extends string> {
  /** Kind of row an id argument names, by argument or input field name. */
  kindByName: Readonly<Record<string, Kind>>;
  /** The same, for one operation: `operation.argument` or `operation.argument.field`. */
  kindByPath: Readonly<Record<string, Kind>>;
  /** A fixed value for a required argument that is not an id, by `operation.argument` path. */
  valueByPath: Readonly<Record<string, unknown>>;
}

export interface BuiltCall {
  document: string;
  variables: Record<string, unknown>;
  /** Every id placed in the variables. */
  sentIds: string[];
  /** Kinds the institute has no row of; a random id was sent in their place. */
  kindsWithoutRow: string[];
}

/** Thrown when a required argument has no rule that fills it. */
export class UnfillableArgumentError extends Error {
  constructor(readonly path: string) {
    super(`No rule fills the required argument "${path}"`);
  }
}

export async function loadSchema(): Promise<GraphQLSchema> {
  const res = await gql<IntrospectionQuery>(getIntrospectionQuery());
  if (res.errors?.length || !res.data) {
    throw new Error(`Introspection failed: ${JSON.stringify(res.errors)}`);
  }
  return buildClientSchema(res.data);
}

export function queryFields(schema: GraphQLSchema): QueryField[] {
  const query = schema.getQueryType();
  if (!query) throw new Error('The schema has no Query type');
  return Object.values(query.getFields()).sort((a, b) => a.name.localeCompare(b.name));
}

const hasRequiredArgument = (field: QueryField): boolean =>
  field.args.some((arg) => isNonNullType(arg.type) && arg.defaultValue === undefined);

/**
 * Every scalar of the type, following object fields `depth` levels down. A nested field that
 * needs an argument is left out: it cannot be called without a value. `skip` holds dotted
 * field paths to leave out, counted from the query field (`myInstitute.config`).
 */
export function selectionFor(
  type: GraphQLOutputType,
  depth: number,
  path: string,
  skip: ReadonlySet<string>,
): string {
  const named = getNamedType(type);
  if (isLeafType(named)) return '';
  if (isAbstractType(named)) return '{ __typename }';
  if (!isObjectType(named)) return '';

  const parts: string[] = ['__typename'];
  for (const field of Object.values(named.getFields())) {
    const fieldPath = `${path}.${field.name}`;
    if (hasRequiredArgument(field) || skip.has(fieldPath)) continue;
    const inner = getNamedType(field.type);
    if (isLeafType(inner)) {
      parts.push(field.name);
    } else if (depth > 0) {
      parts.push(`${field.name} ${selectionFor(field.type, depth - 1, fieldPath, skip)}`);
    }
  }
  return `{ ${parts.join(' ')} }`;
}

/** The dotted field path of a GraphQL error, without list positions. */
export function errorFieldPath(error: { path?: ReadonlyArray<string | number> }): string {
  return (error.path ?? []).filter((part) => typeof part === 'string').join('.');
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** A value for a required argument that is not an id, from its name and type alone. */
function defaultScalar(name: string, typeName: string): unknown {
  if (typeName === 'Boolean') return false;
  if (typeName === 'Int' || typeName === 'Float') return 10;
  if (typeName === 'DateOnly') return today();
  if (typeName === 'DateTime') return new Date().toISOString();
  if (typeName === 'String' && /date$/i.test(name)) return today();
  if (typeName === 'String' && name === 'month') return today().slice(0, 7);
  return undefined;
}

interface FillContext<Kind extends string> {
  tables: ArgumentTables<Kind>;
  ids: Readonly<Partial<Record<Kind, string>>>;
  source: IdSource;
  call: BuiltCall;
  /** How many values the tables chose so far. */
  chosen: number;
}

/**
 * An optional object is sent only when a table chose something inside it: its required
 * fields alone (a date range) would only narrow the result.
 */
function fillObject<Kind extends string>(
  type: GraphQLInputObjectType,
  required: boolean,
  path: string,
  ctx: FillContext<Kind>,
): unknown {
  const chosenBefore = ctx.chosen;
  const value: Record<string, unknown> = {};
  try {
    for (const field of Object.values(type.getFields())) {
      const filled = fillValue(field.type, field.name, `${path}.${field.name}`, ctx);
      if (filled !== undefined) value[field.name] = filled;
    }
  } catch (error) {
    if (required || !(error instanceof UnfillableArgumentError)) throw error;
    return undefined;
  }
  return required || ctx.chosen > chosenBefore ? value : undefined;
}

function fillId<Kind extends string>(
  kind: Kind,
  required: boolean,
  ctx: FillContext<Kind>,
): string | undefined {
  // An optional id narrows a list: send it only when probing with another institute's ids.
  if (!required && ctx.source === 'own') return undefined;
  const id = ctx.ids[kind];
  if (id !== undefined) {
    ctx.chosen += 1;
    ctx.call.sentIds.push(id);
    return id;
  }
  if (!required) return undefined;
  ctx.call.kindsWithoutRow.push(kind);
  const random = randomUUID();
  ctx.call.sentIds.push(random);
  return random;
}

function fillValue<Kind extends string>(
  type: GraphQLInputType,
  name: string,
  path: string,
  ctx: FillContext<Kind>,
): unknown {
  const required = isNonNullType(type);
  const inner = required ? type.ofType : type;

  if (path in ctx.tables.valueByPath) {
    ctx.chosen += 1;
    return ctx.tables.valueByPath[path];
  }

  if (isListType(inner)) {
    if (!required) return undefined;
    const item = fillValue(inner.ofType, name, path, ctx);
    return item === undefined ? [] : [item];
  }

  if (isInputObjectType(inner)) return fillObject(inner, required, path, ctx);

  const kind = ctx.tables.kindByPath[path] ?? ctx.tables.kindByName[name];
  if (kind !== undefined && (inner.name === 'ID' || inner.name === 'String')) {
    return fillId(kind, required, ctx);
  }

  if (!required) return undefined;
  if (isEnumType(inner)) return inner.getValues()[0]?.name;
  const fallback = defaultScalar(name, inner.name);
  if (fallback === undefined) throw new UnfillableArgumentError(path);
  return fallback;
}

/**
 * The document and variables for one query field. Throws `UnfillableArgumentError` when a
 * required argument has no rule. `skip` leaves nested fields out of the selection.
 */
export function buildCall<Kind extends string>(
  field: QueryField,
  tables: ArgumentTables<Kind>,
  ids: Readonly<Partial<Record<Kind, string>>>,
  source: IdSource,
  depth: number,
  skip: ReadonlySet<string> = new Set(),
): BuiltCall {
  const call: BuiltCall = { document: '', variables: {}, sentIds: [], kindsWithoutRow: [] };
  const ctx: FillContext<Kind> = { tables, ids, source, call, chosen: 0 };
  const declared: string[] = [];
  const passed: string[] = [];

  for (const arg of field.args as readonly GraphQLArgument[]) {
    const value = fillValue(arg.type, arg.name, `${field.name}.${arg.name}`, ctx);
    if (value === undefined) continue;
    call.variables[arg.name] = value;
    declared.push(`$${arg.name}: ${arg.type.toString()}`);
    passed.push(`${arg.name}: $${arg.name}`);
  }

  const head =
    declared.length > 0 ? `query TwoInstitute(${declared.join(', ')})` : 'query TwoInstitute';
  const args = passed.length > 0 ? `(${passed.join(', ')})` : '';
  call.document = `${head} { ${field.name}${args} ${selectionFor(field.type, depth, field.name, skip)} }`;
  return call;
}
