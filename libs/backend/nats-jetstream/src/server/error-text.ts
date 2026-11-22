const MAX_LENGTH = 500;

function innermost(err: Error): unknown {
  const seen = new Set<unknown>([err]);
  let current: unknown = err;
  while (current instanceof Error && current.cause !== undefined && !seen.has(current.cause)) {
    seen.add(current.cause);
    current = current.cause;
  }
  return current;
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const { message } = value;
    if (typeof message === 'string') return message;
  }
  return JSON.stringify(value) ?? String(value);
}

/**
 * The text a dead-letter entry stores: `<name>: <message of the innermost cause>`. The innermost
 * cause drops wrappers such as Drizzle's "Failed query: … params: …", which carry row data.
 */
export function deadLetterErrorText(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${messageOf(innermost(err))}` : messageOf(err);
  return text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH) : text;
}
