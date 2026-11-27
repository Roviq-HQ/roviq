/** The ids a resolved value may carry for the caller it answers. */
export interface ExpectedScope {
  tenantId?: string;
  resellerId?: string;
}

/**
 * The most objects and arrays one resolved value may hold. The largest page the API returns is
 * 10,000 students (`StudentFilterInput.first`), so this allows 100 objects per row of it; every
 * other list is capped at 100 rows or is one institute's own structure. A value past it is not
 * read to the end, and the caller treats that as a failed check.
 */
export const MAX_SCAN_NODES = 1_000_000;

export interface ForeignScope {
  /** `tenantId` or `resellerId`: which of the caller's ids the value disagrees with. */
  kind: 'tenantId' | 'resellerId';
  /** The id found in the value. */
  found: string;
}

export interface ScanResult {
  foreign: ForeignScope | null;
  /** True when the value held more than the node limit, so part of it was not read. */
  truncated: boolean;
}

const KEY_KIND: Readonly<Record<string, ForeignScope['kind']>> = {
  tenantId: 'tenantId',
  tenant_id: 'tenantId',
  resellerId: 'resellerId',
  reseller_id: 'resellerId',
};

/** True for a value that can hold rows: an array or an object that is not a date, bytes or a stream. */
export function isWalkable(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return true;
  if (value instanceof Date || ArrayBuffer.isView(value) || value instanceof Promise) return false;
  if (value instanceof Map || value instanceof Set) return false;
  // Streams and subscription iterators are not data.
  if (Symbol.asyncIterator in value || Symbol.iterator in value) return false;
  return true;
}

/**
 * Looks through a resolved value, to any depth, for a `tenantId` or `resellerId` that is not
 * the caller's. Only the kinds present in `expected` are compared; a null or missing id is not
 * a mismatch.
 */
export function findForeignScope(
  value: unknown,
  expected: ExpectedScope,
  maxNodes: number = MAX_SCAN_NODES,
): ScanResult {
  if (!isWalkable(value)) return { foreign: null, truncated: false };
  const seen = new WeakSet<object>();
  const stack: object[] = [value];
  let nodes = 0;

  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (seen.has(node)) continue;
    seen.add(node);
    nodes += 1;
    if (nodes > maxNodes) return { foreign: null, truncated: true };

    for (const [key, child] of Object.entries(node)) {
      const kind = KEY_KIND[key];
      if (kind && typeof child === 'string') {
        const own = expected[kind];
        if (own !== undefined && child.toLowerCase() !== own.toLowerCase()) {
          return { foreign: { kind, found: child }, truncated: false };
        }
        continue;
      }
      if (isWalkable(child)) stack.push(child);
    }
  }
  return { foreign: null, truncated: false };
}
