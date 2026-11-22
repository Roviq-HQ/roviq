import { NotificationSkipReason } from '@roviq/common-types';

export interface ChannelGateChecks {
  /** Institute setting for the channel; always true for critical and secret types. */
  channelEnabled: boolean;
  consents(): Promise<boolean>;
  hasProvider: boolean;
  /** The recipient's addresses on this channel; empty when there are none. */
  resolveAddresses(): Promise<readonly string[]>;
}

export type ChannelGateResult =
  | { open: true; addresses: readonly string[] }
  | { open: false; reason: NotificationSkipReason };

/** The single gate both send paths use. Checks run in this order and stop at the first "no". */
export async function evaluateChannelGate(checks: ChannelGateChecks): Promise<ChannelGateResult> {
  if (!checks.channelEnabled)
    return { open: false, reason: NotificationSkipReason.CHANNEL_DISABLED };
  if (!(await checks.consents())) return { open: false, reason: NotificationSkipReason.NO_CONSENT };
  if (!checks.hasProvider) return { open: false, reason: NotificationSkipReason.NO_PROVIDER };
  const addresses = await checks.resolveAddresses();
  if (addresses.length === 0) return { open: false, reason: NotificationSkipReason.NO_ADDRESS };
  return { open: true, addresses };
}
