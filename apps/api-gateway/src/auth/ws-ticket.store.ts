import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@roviq/common-types';
import type Redis from 'ioredis';
import { z } from 'zod';
import { REDIS_KEYS } from './redis-keys';

export const WS_TICKET_TTL_SECONDS = 30;

const baseUserSchema = z.object({
  userId: z.string().min(1),
  membershipId: z.string().min(1),
  roleId: z.string().min(1),
  type: z.literal('access'),
  mustChangePassword: z.boolean().optional(),
  isImpersonated: z.boolean().optional(),
  impersonatorId: z.string().optional(),
  impersonationSessionId: z.string().optional(),
});

// Mirrors AuthUser so the socket carries the same claims the HTTP guards read
// (impersonation session, forced password change), not a subset of them.
const ticketUserSchema = z.discriminatedUnion('scope', [
  baseUserSchema.extend({ _scope: z.literal('platform'), scope: z.literal('platform') }),
  baseUserSchema.extend({
    _scope: z.literal('reseller'),
    scope: z.literal('reseller'),
    resellerId: z.string().min(1),
  }),
  baseUserSchema.extend({
    _scope: z.literal('institute'),
    scope: z.literal('institute'),
    tenantId: z.string().min(1),
    resellerId: z.string().optional(),
  }),
]);

const ticketSchema = z.uuid();

export async function issueWsTicket(redis: Redis, user: AuthUser): Promise<string> {
  const ticket = randomUUID();
  await redis.set(
    `${REDIS_KEYS.WS_TICKET}${ticket}`,
    JSON.stringify(ticketUserSchema.parse(user)),
    'EX',
    WS_TICKET_TTL_SECONDS,
  );
  return ticket;
}

/** Returns the ticket's user once; null when it is missing, malformed, expired or already used. */
export async function consumeWsTicket(redis: Redis, ticket: unknown): Promise<AuthUser | null> {
  const parsedTicket = ticketSchema.safeParse(ticket);
  if (!parsedTicket.success) return null;

  // GETDEL is atomic: two sockets racing on one ticket cannot both read it.
  const data = await redis.getdel(`${REDIS_KEYS.WS_TICKET}${parsedTicket.data}`);
  if (!data) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  const parsedUser = ticketUserSchema.safeParse(payload);
  return parsedUser.success ? parsedUser.data : null;
}
