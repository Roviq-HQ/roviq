import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** null for platform-admin requests (not scoped to a tenant) */
  tenantId: string | null;
  userId: string;
  impersonatorId: string | null;
  correlationId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext {
  const ctx = requestContext.getStore();
  if (!ctx) throw new Error('No request context — are you inside a request?');
  return ctx;
}
