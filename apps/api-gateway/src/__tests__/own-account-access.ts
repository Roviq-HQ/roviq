// The `withUser()` call sites that let an impersonation session read (`'IMPERSONATOR_MAY_READ'`),
// each with the reason. Every other call site is `'PERSON_ONLY'` and refuses the session.
// An entry is a security decision: the call runs in a read-only transaction as the impersonated
// person, so add one only for a read the impersonator's screens need, never for anything that
// names the person's sessions, devices, passkeys or password.
// `own-account-access.spec.ts` fails when a call site and this list disagree.

/** `<file>#<method>` → why an impersonation session may read here. */
export const IMPERSONATOR_READS: Readonly<Record<string, string>> = {
  'apps/api-gateway/src/auth/repositories/user.drizzle-repository.ts#getPreferredLocale':
    "The portal opens in the impersonated person's language.",
  'apps/api-gateway/src/auth/repositories/user.drizzle-repository.ts#findOwnName':
    'The `me` query: the app shell shows whose account is on screen. Selects the sign-in name and email only.',
  'apps/api-gateway/src/institute/user/repositories/profile.drizzle-repository.ts#findUserProfile':
    "The person's profile page (`myProfile`, `myChildren`), which support staff look at with them.",
  'apps/api-gateway/src/institute/institute-group/repositories/institute-group.drizzle-repository.ts#findOwnMemberships':
    "The person's own groups list (`myGroups`).",
  'apps/api-gateway/src/notification-inbox/repositories/notification-inbox.drizzle-repository.ts#run':
    "Reading a platform person's inbox. Its writes call `assertOwnSession` first, and the read-only transaction refuses them again.",
};
