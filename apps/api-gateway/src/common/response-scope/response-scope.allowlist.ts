/**
 * Root operations whose result may carry a `tenantId` or `resellerId` other than the caller's,
 * each with the reason. An entry is a security decision: it switches the response check off for
 * that operation, so add one only when the foreign id is the caller's own to see.
 */
export const FOREIGN_SCOPE_ALLOWED: Readonly<Record<string, string>> = {
  switchInstitute:
    "Answers with the session for the institute being switched to. The service issues it only for the caller's own active membership there.",
};
