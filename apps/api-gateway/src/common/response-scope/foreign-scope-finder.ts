/** The ids a resolver's result may carry for the caller it answers. */
export interface ExpectedScope {
  tenantId?: string;
  resellerId?: string;
}

export interface ScanLimits {
  maxDepth: number;
  maxNodes: number;
}

/** Deep enough for a page of rows with two levels of relations; wide enough for a full export page. */
export const DEFAULT_SCAN_LIMITS: ScanLimits = { maxDepth: 8, maxNodes: 50_000 };

export interface ForeignScope {
  /** `tenantId` or `resellerId`: which of the caller's ids the value disagrees with. */
  kind: 'tenantId' | 'resellerId';
  /** The id found in the result. */
  found: string;
}

export interface ScanResult {
  foreign: ForeignScope | null;
  /** True when the result was larger than the limits, so part of it was not read. */
  truncated: boolean;
}

const KEY_KIND: Readonly<Record<string, ForeignScope['kind']>> = {
  tenantId: 'tenantId',
  tenant_id: 'tenantId',
  resellerId: 'resellerId',
  reseller_id: 'resellerId',
};

function isWalkable(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return true;
  if (value instanceof Date || ArrayBuffer.isView(value) || value instanceof Promise) return false;
  if (value instanceof Map || value instanceof Set) return false;
  // Streams and subscription iterators are not data.
  if (Symbol.asyncIterator in value || Symbol.iterator in value) return false;
  return true;
}

/**
 * Looks through a resolver's result for a `tenantId` or `resellerId` that is not the caller's.
 * Only the kinds present in `expected` are compared; a null or missing id is not a mismatch.
 */
export function findForeignScope(
  value: unknown,
  expected: ExpectedScope,
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
): ScanResult {
  if (!isWalkable(value)) return { foreign: null, truncated: false };
  const seen = new WeakSet<object>();
  const stack: Array<{ node: object; depth: number }> = [{ node: value, depth: 0 }];
  let nodes = 0;
  let truncated = false;

  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: object; depth: number };
    if (seen.has(node)) continue;
    seen.add(node);
    nodes += 1;
    if (nodes > limits.maxNodes) return { foreign: null, truncated: true };

    for (const [key, child] of Object.entries(node)) {
      const kind = KEY_KIND[key];
      if (kind && typeof child === 'string') {
        const own = expected[kind];
        if (own !== undefined && child.toLowerCase() !== own.toLowerCase()) {
          return { foreign: { kind, found: child }, truncated };
        }
        continue;
      }
      if (!isWalkable(child)) continue;
      if (depth + 1 > limits.maxDepth) {
        truncated = true;
        continue;
      }
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  return { foreign: null, truncated };
}
