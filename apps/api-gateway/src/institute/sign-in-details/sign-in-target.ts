import {
  type DrizzleDB,
  phoneNumbersLive,
  tenantUserProfilesLive,
  usersLive,
} from '@roviq/database';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { SignInTarget } from './sign-in-details.service';

/** One plain name for a message to the person: English, else the first locale. */
export function englishOrFirst(name: Record<string, string> | null | undefined): string | null {
  if (!name) return null;
  return name.en ?? Object.values(name)[0] ?? null;
}

/**
 * Account details of a user whose id came from this institute's own profile row. Run inside
 * `withTenant`; the name is the institute's copy.
 */
export async function readSignInTarget(
  tx: DrizzleDB,
  tenantId: string,
  userId: string,
): Promise<SignInTarget | null> {
  const [account] = await tx
    .select({
      username: usersLive.username,
      email: usersLive.email,
      mustChangePassword: usersLive.mustChangePassword,
      firstName: tenantUserProfilesLive.firstName,
      lastName: tenantUserProfilesLive.lastName,
    })
    .from(usersLive)
    .leftJoin(
      tenantUserProfilesLive,
      and(
        eq(tenantUserProfilesLive.userId, usersLive.id),
        eq(tenantUserProfilesLive.tenantId, tenantId),
      ),
    )
    .where(eq(usersLive.id, userId))
    .limit(1);
  if (!account) return null;
  const [phone] = await tx
    .select({ countryCode: phoneNumbersLive.countryCode, number: phoneNumbersLive.number })
    .from(phoneNumbersLive)
    .where(eq(phoneNumbersLive.userId, userId))
    .orderBy(desc(phoneNumbersLive.isPrimary), asc(phoneNumbersLive.createdAt))
    .limit(1);
  return {
    userId,
    username: account.username,
    email: account.email,
    phone: phone ?? null,
    firstName: englishOrFirst(account.firstName),
    lastName: englishOrFirst(account.lastName),
    mustChangePassword: account.mustChangePassword,
  };
}
