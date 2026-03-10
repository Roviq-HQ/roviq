import 'reflect-metadata';

const AUDIT_MASK_KEY = Symbol('AUDIT_MASK');

export function AuditMask(): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: string[] = Reflect.getMetadata(AUDIT_MASK_KEY, target.constructor) ?? [];
    Reflect.defineMetadata(AUDIT_MASK_KEY, [...existing, String(propertyKey)], target.constructor);
  };
}

export function getAuditMaskedFields(target: new (...args: unknown[]) => unknown): string[] {
  return Reflect.getMetadata(AUDIT_MASK_KEY, target) ?? [];
}
