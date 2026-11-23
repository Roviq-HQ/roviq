import {
  isPlaceholderEmail,
  type NotificationDeliveryStatus,
  SignInStatus,
} from '@roviq/common-types';
import {
  type DrizzleDB,
  notificationDeliveries,
  phoneNumbersLive,
  usersLive,
} from '@roviq/database';
import { and, desc, eq, inArray } from 'drizzle-orm';

export interface SignInState {
  signInStatus: SignInStatus;
  signInDetailsSentAt: Date | null;
}

export interface SignInFacts {
  mustChangePassword: boolean;
  hasRealContact: boolean;
  /** The latest USER_WELCOME delivery row of each channel. */
  latestPerChannel: readonly { status: NotificationDeliveryStatus; createdAt: Date }[];
}

const REACHED: readonly NotificationDeliveryStatus[] = ['SENT', 'DELIVERED'];

/**
 * Every send writes one row per channel, so the latest row of each channel describes the
 * latest send; one channel that reached the provider is enough for the person to sign in.
 */
export function deriveSignInState(facts: SignInFacts): SignInState {
  const reached = facts.latestPerChannel.filter((row) => REACHED.includes(row.status));
  const signInDetailsSentAt =
    reached.length > 0
      ? new Date(Math.max(...reached.map((row) => row.createdAt.getTime())))
      : null;
  let signInStatus: SignInStatus;
  if (!facts.mustChangePassword) signInStatus = SignInStatus.SIGNED_IN;
  else if (reached.length > 0) signInStatus = SignInStatus.DETAILS_SENT;
  else if (facts.latestPerChannel.some((row) => row.status === 'FAILED'))
    signInStatus = SignInStatus.SEND_FAILED;
  else if (!facts.hasRealContact) signInStatus = SignInStatus.NOT_SENT_NO_CONTACT;
  else signInStatus = SignInStatus.NOT_SENT;
  return { signInStatus, signInDetailsSentAt };
}

/**
 * Sign-in state of these users as this institute sees it: three statements for any number of
 * users. Run inside `withTenant`; RLS limits the delivery rows to this institute's.
 */
export async function readSignInStates(
  tx: DrizzleDB,
  tenantId: string,
  userIds: readonly string[],
): Promise<Map<string, SignInState>> {
  const ids = [...new Set(userIds)];
  const states = new Map<string, SignInState>();
  if (ids.length === 0) return states;

  const accounts = await tx
    .select({
      userId: usersLive.id,
      email: usersLive.email,
      mustChangePassword: usersLive.mustChangePassword,
    })
    .from(usersLive)
    .where(inArray(usersLive.id, ids));

  // Its own statement: a correlated subquery here loses the outer table name and matches nothing.
  const phoneRows = await tx
    .selectDistinct({ userId: phoneNumbersLive.userId })
    .from(phoneNumbersLive)
    .where(inArray(phoneNumbersLive.userId, ids));
  const withPhone = new Set(phoneRows.map((row) => row.userId));

  const deliveries = await tx
    .selectDistinctOn([notificationDeliveries.recipientUserId, notificationDeliveries.channel], {
      userId: notificationDeliveries.recipientUserId,
      status: notificationDeliveries.status,
      createdAt: notificationDeliveries.createdAt,
    })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.type, 'USER_WELCOME'),
        eq(notificationDeliveries.scope, 'institute'),
        eq(notificationDeliveries.tenantId, tenantId),
        inArray(notificationDeliveries.recipientUserId, ids),
      ),
    )
    .orderBy(
      notificationDeliveries.recipientUserId,
      notificationDeliveries.channel,
      desc(notificationDeliveries.createdAt),
      desc(notificationDeliveries.id),
    );

  for (const account of accounts) {
    states.set(
      account.userId,
      deriveSignInState({
        mustChangePassword: account.mustChangePassword,
        hasRealContact: !isPlaceholderEmail(account.email) || withPhone.has(account.userId),
        latestPerChannel: deliveries.filter((row) => row.userId === account.userId),
      }),
    );
  }
  return states;
}

/** The rows with their sign-in state; a user with no live account reads as NOT_SENT. */
export async function withSignInStates<T extends { userId: string }>(
  tx: DrizzleDB,
  tenantId: string,
  rows: readonly T[],
): Promise<(T & SignInState)[]> {
  const states = await readSignInStates(
    tx,
    tenantId,
    rows.map((row) => row.userId),
  );
  return rows.map((row) => ({
    ...row,
    ...(states.get(row.userId) ?? {
      signInStatus: SignInStatus.NOT_SENT,
      signInDetailsSentAt: null,
    }),
  }));
}
