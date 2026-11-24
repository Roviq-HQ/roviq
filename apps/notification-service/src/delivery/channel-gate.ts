import { NotificationSkipReason } from '@roviq/common-types';

/** Why a message waits: a value of `notification_deliveries.skip_reason` on a DEFERRED row. */
export type DeferReason = Extract<
  NotificationSkipReason,
  'quiet_hours' | 'sender_cap' | 'rate_limited' | 'provider_paused'
>;

export type SenderCapacity = 'ok' | 'over' | { deferUntil: Date };

export interface ChannelGateChecks {
  /** Institute setting for the channel; always true for critical and secret types. */
  channelEnabled: boolean;
  consents(): Promise<boolean>;
  /** An adapter exists and, on a channel that sends through senders, an active sender too. */
  hasProvider: boolean | (() => Promise<boolean>);
  /** Only on a channel that needs an approved template; absent means no template is needed. */
  hasTemplate?(): Promise<boolean>;
  /** The recipient's addresses on this channel; empty when there are none. */
  resolveAddresses(): Promise<readonly string[]>;
  /** The recipient asked the sender to stop. */
  optedOut?(addresses: readonly string[]): Promise<boolean>;
  /** When quiet hours end for this message; null when it may go now. */
  quietUntil?(): Promise<Date | null>;
  capacity?(): Promise<SenderCapacity>;
}

export type ChannelGateResult =
  | { open: true; addresses: readonly string[] }
  | { open: false; reason: NotificationSkipReason }
  /** Not refused: try again at `deferUntil`. */
  | { open: false; deferUntil: Date; deferReason: DeferReason };

/**
 * The single gate both send paths use. Checks run in this order and stop at the first "no":
 * institute setting, consent, provider, template, address, opt-out, quiet hours, sender cap.
 */
export async function evaluateChannelGate(checks: ChannelGateChecks): Promise<ChannelGateResult> {
  if (!checks.channelEnabled)
    return { open: false, reason: NotificationSkipReason.CHANNEL_DISABLED };
  if (!(await checks.consents())) return { open: false, reason: NotificationSkipReason.NO_CONSENT };
  const hasProvider =
    typeof checks.hasProvider === 'boolean' ? checks.hasProvider : await checks.hasProvider();
  if (!hasProvider) return { open: false, reason: NotificationSkipReason.NO_PROVIDER };
  if (checks.hasTemplate && !(await checks.hasTemplate()))
    return { open: false, reason: NotificationSkipReason.NO_TEMPLATE };
  const addresses = await checks.resolveAddresses();
  if (addresses.length === 0) return { open: false, reason: NotificationSkipReason.NO_ADDRESS };
  if (checks.optedOut && (await checks.optedOut(addresses)))
    return { open: false, reason: NotificationSkipReason.OPTED_OUT };
  const quietUntil = checks.quietUntil ? await checks.quietUntil() : null;
  if (quietUntil) return { open: false, deferUntil: quietUntil, deferReason: 'quiet_hours' };
  const capacity = checks.capacity ? await checks.capacity() : 'ok';
  if (capacity === 'over') return { open: false, reason: NotificationSkipReason.SENDER_CAP };
  if (capacity !== 'ok')
    return { open: false, deferUntil: capacity.deferUntil, deferReason: 'sender_cap' };
  return { open: true, addresses };
}
