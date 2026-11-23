import 'reflect-metadata';

const AUDIT_MASK_KEY = Symbol('AUDIT_MASK');

export const AUDIT_REDACTED = '[REDACTED]';

/** Every property name marked with `@AuditMask()` in a loaded class. */
const maskedNames = new Set<string>();

/**
 * Marks an input field whose value must never reach the audit log (a password, a token, a
 * provider credential). The audit interceptor replaces the value of every argument property
 * with this name, at any depth, by `[REDACTED]`. Matching is by name: an argument passed
 * outside an input class is covered when it carries the same name.
 */
export function AuditMask(): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: string[] = Reflect.getMetadata(AUDIT_MASK_KEY, target.constructor) ?? [];
    Reflect.defineMetadata(AUDIT_MASK_KEY, [...existing, String(propertyKey)], target.constructor);
    maskedNames.add(String(propertyKey));
  };
}

export function getAuditMaskedFields(target: new (...args: unknown[]) => unknown): string[] {
  return Reflect.getMetadata(AUDIT_MASK_KEY, target) ?? [];
}

/** A JSON copy of `value` with every masked property redacted, however deep; bigint as string. */
export function redactAuditMasked(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, inner) => {
      if (maskedNames.has(key) && inner !== undefined && inner !== null) return AUDIT_REDACTED;
      return typeof inner === 'bigint' ? inner.toString() : inner;
    }),
  );
}
