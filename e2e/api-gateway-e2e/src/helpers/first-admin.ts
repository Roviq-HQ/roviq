import { randomUUID } from 'node:crypto';

/** A first admin with an address no other test uses, so the request always creates a new user. */
export function firstAdminInput(): { firstName: string; lastName: string; email: string } {
  return {
    firstName: 'E2E',
    lastName: 'Admin',
    email: `e2e-first-admin-${randomUUID()}@institute.test`,
  };
}
