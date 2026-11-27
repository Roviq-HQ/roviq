/**
 * Ids of workflows a client can name in a later request (to read progress, signal or cancel).
 * The id carries the institute, so the request is checked against the caller's token before
 * the workflow is looked up.
 */

/** `{kind}-{tenantId}-{unique}`. `unique` is random or an id the server generated. */
export function tenantWorkflowId(kind: string, tenantId: string, unique: string): string {
  return `${kind}-${tenantId}-${unique}`;
}

/** True only for an id `tenantWorkflowId` built for this kind and this institute. */
export function isTenantWorkflowId(workflowId: string, kind: string, tenantId: string): boolean {
  const prefix = `${kind}-${tenantId}-`;
  return tenantId.length > 0 && workflowId.startsWith(prefix) && workflowId.length > prefix.length;
}
