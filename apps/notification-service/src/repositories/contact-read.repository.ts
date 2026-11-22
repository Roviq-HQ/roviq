import type { ContactRecord } from './types';

/**
 * A user's addresses, read at send time from the user id. Users, phones and device tokens are
 * platform tables with no institute policy, so these run as the platform role, keyed by one
 * user id that the pipeline resolved itself.
 */
export abstract class ContactReadRepository {
  abstract findContact(userId: string): Promise<ContactRecord | null>;
  abstract findDeviceTokens(userId: string): Promise<string[]>;
  /** Soft-deletes a token the push provider reported as no longer registered. */
  abstract retireDeviceToken(token: string): Promise<void>;
}
