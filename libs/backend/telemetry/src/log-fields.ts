// The fields a log record may hold. A field that is not listed here is dropped before the
// line is written, and its name is recorded in `dropped_fields` so that it is noticed and
// either listed or removed from the call (docs/deployment.md → "Telemetry and shutdown").
//
// A listed field holds an identifier, a name from the code, a count or a duration: never a
// request header, a GraphQL variable, a cookie, a body, or a person's name, phone or e-mail.

import pino, {
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from 'pino';
import { serializeRequest, serializeResponse } from './redaction';

export const LOG_FIELDS: ReadonlySet<string> = new Set([
  // Set by pino and the OpenTelemetry log bridge.
  'pid',
  'hostname',
  'trace_id',
  'span_id',
  'trace_flags',
  // Where the line comes from.
  'context',
  'module',
  // A request: method, path and status only (`serializeRequest`, `serializeResponse`).
  'req',
  'res',
  'responseTime',
  // An error: type, message, stack and code only (`serializeError`).
  'err',
  // Identifiers.
  'tenantId',
  'userId',
  'correlationId',
  'correlation_id',
  // A refused or failed GraphQL field: its name, the error code and the refusal message.
  'field',
  'code',
  'reason',
  // The alert rule a monitoring query belongs to.
  'alert',
  // A dead-lettered event.
  'dlq.message',
  'dlq.subject',
  'dlq.origin_stream',
  'dlq.error',
  'dlq.retry_count',
]);

export const DROPPED_FIELDS_KEY = 'dropped_fields';

const HIDDEN_VALUES = '[values not logged]';

/**
 * Remove the parameter values a database driver appends to a failed query's message
 * (`Failed query: …\nparams: …`). The statement with its placeholders stays.
 */
export function withoutQueryValues(text: string): string {
  return text.replace(/(\nparams: )[\s\S]*?(?=\n\s+at |$)/g, `$1${HIDDEN_VALUES}`);
}

function withoutQueryValuesIn(value: unknown): unknown {
  return typeof value === 'string' ? withoutQueryValues(value) : value;
}

/** Keep the listed fields of a log record and name the others in `dropped_fields`. */
export function keepListedLogFields(record: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (LOG_FIELDS.has(key)) kept[key] = withoutQueryValuesIn(value);
    else dropped.push(key);
  }
  if (dropped.length > 0) kept[DROPPED_FIELDS_KEY] = dropped.sort();
  return kept;
}

export interface LoggedError {
  type: string;
  message: string;
  stack: string | undefined;
  code: string | number | undefined;
  cause?: LoggedError;
}

const MAX_CAUSE_DEPTH = 3;

/**
 * Type, message, stack and code of an error, and of its causes. Every other property is
 * left out: a driver or HTTP client error carries the query parameters, the row that was
 * refused, or the request headers.
 */
export function serializeError(error: unknown, depth = 0): LoggedError | unknown {
  if (error === null || typeof error !== 'object') return withoutQueryValuesIn(error);
  const source = error as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    code?: unknown;
    cause?: unknown;
    constructor?: { name?: string };
  };
  const logged: LoggedError = {
    type: typeof source.name === 'string' ? source.name : (source.constructor?.name ?? 'Error'),
    message: withoutQueryValues(String(source.message ?? '')),
    stack: typeof source.stack === 'string' ? withoutQueryValues(source.stack) : undefined,
    code:
      typeof source.code === 'string' || typeof source.code === 'number' ? source.code : undefined,
  };
  if (source.cause !== undefined && source.cause !== null && depth < MAX_CAUSE_DEPTH) {
    const cause = serializeError(source.cause, depth + 1);
    if (cause !== null && typeof cause === 'object') logged.cause = cause as LoggedError;
  }
  return logged;
}

const listedFieldsLogOptions: Pick<LoggerOptions, 'formatters' | 'serializers' | 'hooks'> = {
  formatters: { log: keepListedLogFields, bindings: keepListedLogFields },
  serializers: { req: serializeRequest, res: serializeResponse, err: serializeError },
  hooks: {
    logMethod(args, method) {
      method.apply(this, args.map(withoutQueryValuesIn) as Parameters<typeof method>);
    },
  },
};

/** The serializers of a listed logger, for a library that builds its own child of it. */
export const listedLogSerializers = listedFieldsLogOptions.serializers;

/**
 * Build a logger that writes listed fields only: in a record, in the bindings of every child
 * made from it at any depth, and with no query values in a message. Every Roviq logger is
 * built here.
 */
export function createListedLogger(options: LoggerOptions, stream?: DestinationStream): Logger {
  const settings = { ...options, ...listedFieldsLogOptions };
  const logger = stream ? pino(settings, stream) : pino(settings);
  // pino applies the bindings formatter to the root only. A child is made with
  // Object.create(parent), so this own property is what every descendant calls.
  const makeChild: (this: Logger, bindings: Bindings, options?: ChildLoggerOptions) => Logger =
    logger.child;
  Object.defineProperty(logger, 'child', {
    configurable: true,
    writable: true,
    value(this: Logger, bindings: Bindings, childOptions?: ChildLoggerOptions): Logger {
      return makeChild.call(this, keepListedLogFields(bindings), childOptions);
    },
  });
  return logger;
}
