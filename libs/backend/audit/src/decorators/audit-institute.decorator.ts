import { Reflector } from '@nestjs/core';

/**
 * On a platform or reseller mutation that acts on one institute: the path of the argument that
 * holds that institute's id, e.g. `'id'` or `'input.tenantId'`. The audit row then names the
 * institute as its subject, so the institute can read it in its own audit log.
 */
export const AuditInstitute = Reflector.createDecorator<string>();

const marked = new WeakMap<object, string>();

/**
 * For a mutation whose arguments do not hold the institute id (a download by file id): call
 * with the request once the institute is known.
 */
export function markAuditInstitute(req: object, instituteId: string): void {
  marked.set(req, instituteId);
}

export function markedAuditInstitute(req: object): string | null {
  return marked.get(req) ?? null;
}
