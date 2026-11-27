import type { AuthUser } from '@roviq/common-types';

interface GroupResolutionEvent {
  groupMembershipResolved: { tenantId?: string | null; groupId: string };
}

/** Delivers a resolution only to its own institute, and only for the group asked for. */
export function isOwnGroupResolution(
  payload: GroupResolutionEvent,
  variables: { groupId: string },
  context: { req: { user: AuthUser } },
): boolean {
  const event = payload.groupMembershipResolved;
  const user = context.req.user;
  return (
    user.scope === 'institute' &&
    typeof event.tenantId === 'string' &&
    event.tenantId === user.tenantId &&
    event.groupId === variables.groupId
  );
}
