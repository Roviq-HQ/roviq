import { NOTIFICATION_CHANNEL_VALUES, type NotificationChannel } from '@roviq/common-types';
import { PAID_CHANNELS } from './flow-channels';

/**
 * A notification type's flow (ROV-332): which channels are tried, in what order, for which
 * recipients, and how long each waits for proof that the message arrived. A flow is plain data:
 * it travels in the workflow input and one generic workflow walks it. It never holds an address,
 * a code or a password.
 */

type Unit = 'second' | 'seconds' | 'minute' | 'minutes' | 'hour' | 'hours';
export type FlowDuration = `${number} ${Unit}`;

const UNIT_MS: Record<Unit, number> = {
  second: 1_000,
  seconds: 1_000,
  minute: 60_000,
  minutes: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

export function durationMs(duration: FlowDuration): number {
  const [amount, unit] = duration.split(' ');
  const ms = Number(amount) * (UNIT_MS[unit as Unit] ?? Number.NaN);
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Invalid flow duration "${duration}"`);
  return ms;
}

export { appOnlyFlow, PAID_CHANNELS } from './flow-channels';

/** A named condition a step may depend on; evaluated by the workflow from its own input. */
export type FlowCondition = 'type_is_critical' | 'audience_is_institute';

/**
 * Who a step sends to. `all`: every recipient at once. `each_in_turn`: the first recipient,
 * and the next one only when the one before was not reached.
 */
export type StepTarget = 'all' | 'each_in_turn';

export interface SendStep {
  kind: 'send';
  /** One channel, or several sent together; arrival on any one satisfies the step. */
  channels: NotificationChannel[];
  /** True for the app step: reading or archiving the in-app notification also counts as arrival. */
  app: boolean;
  to: StepTarget;
  /** How long to wait for arrival after a send; null moves on at once. */
  waitMs: number | null;
  onlyIf: FlowCondition | null;
}

export interface DelayStep {
  kind: 'delay';
  ms: number;
}

/** Runs the inner steps for the first recipient; for the next only when they end without arrival. */
export interface ForEachRecipientStep {
  kind: 'for_each_recipient';
  steps: SendStep[];
}

export type FlowStep = SendStep | DelayStep | ForEachRecipientStep;

/** Where a type's recipients come from; null means the one recipient the event names. */
export type FlowRecipients = 'guardians_in_order' | null;

export interface NotificationFlow {
  recipients: FlowRecipients;
  /** How many recipients the paid steps may go through; null means all of them. */
  maxPaidRecipients: number | null;
  steps: FlowStep[];
  /** The flow ends as soon as any recipient is confirmed reached on any channel. */
  stopWhen: 'anyone_reached';
}

interface SendOptions {
  to?: StepTarget;
  waitForArrival?: FlowDuration;
  onlyIf?: FlowCondition;
}

function send(channels: NotificationChannel[], app: boolean, options: SendOptions): SendStep {
  return {
    kind: 'send',
    channels,
    app,
    to: options.to ?? 'all',
    waitMs: options.waitForArrival ? durationMs(options.waitForArrival) : null,
    onlyIf: options.onlyIf ?? null,
  };
}

export const step = {
  /** The in-app notification alone: no push, nothing outside the app. */
  inAppOnly: (): SendStep => send([], true, {}),
  /** The in-app notification and a push to the recipient's devices. */
  app: (options: SendOptions = {}): SendStep => send(['PUSH'], true, options),
  channel: (channel: NotificationChannel, options: SendOptions = {}): SendStep =>
    send([channel], false, options),
  /** Several channels at once. */
  parallel: (channels: NotificationChannel[], options: SendOptions = {}): SendStep =>
    send(channels, channels.includes('PUSH'), options),
  delay: (duration: FlowDuration): DelayStep => ({ kind: 'delay', ms: durationMs(duration) }),
  forEachRecipient: (steps: SendStep[]): ForEachRecipientStep => ({
    kind: 'for_each_recipient',
    steps,
  }),
};

export const guardiansInOrder = (): FlowRecipients => 'guardians_in_order';

export function defineFlow(flow: {
  recipients?: FlowRecipients;
  maxPaidRecipients?: number;
  steps: FlowStep[];
}): NotificationFlow {
  return {
    recipients: flow.recipients ?? null,
    maxPaidRecipients: flow.maxPaidRecipients ?? null,
    steps: flow.steps,
    stopWhen: 'anyone_reached',
  };
}

/** Every channel a flow may send on, in first-use order. */
export function channelsOf(flow: NotificationFlow): NotificationChannel[] {
  const seen = new Set<NotificationChannel>();
  for (const s of flow.steps) {
    const sends = s.kind === 'send' ? [s] : s.kind === 'for_each_recipient' ? s.steps : [];
    for (const one of sends) for (const channel of one.channels) seen.add(channel);
  }
  return [...seen];
}

const KNOWN_CHANNELS: ReadonlySet<string> = new Set(NOTIFICATION_CHANNEL_VALUES);

function sendProblems(s: SendStep, where: string, flow: NotificationFlow): string[] {
  const problems: string[] = [];
  if (s.channels.length === 0 && !s.app) problems.push(`${where}: no channel`);
  for (const channel of s.channels) {
    if (!KNOWN_CHANNELS.has(channel)) problems.push(`${where}: unknown channel "${channel}"`);
  }
  if (new Set(s.channels).size !== s.channels.length) problems.push(`${where}: a channel twice`);
  if (s.waitMs !== null && !(s.waitMs > 0)) problems.push(`${where}: wait must be positive`);
  // One paid message at a time: with several recipients a paid channel never goes to all at once.
  if (
    flow.recipients !== null &&
    s.to === 'all' &&
    s.channels.some((channel) => PAID_CHANNELS.has(channel))
  ) {
    problems.push(`${where}: a paid channel must go to one recipient at a time`);
  }
  return problems;
}

/** Problems of a flow, empty when it is valid. Run for every registered type by a unit test. */
export function flowProblems(flow: NotificationFlow | null | undefined): string[] {
  if (!flow) return ['the type has no flow'];
  if (flow.steps.length === 0) return ['the flow has no step'];
  const problems: string[] = [];
  if (
    flow.maxPaidRecipients !== null &&
    !(Number.isInteger(flow.maxPaidRecipients) && flow.maxPaidRecipients >= 1)
  ) {
    problems.push('maxPaidRecipients must be a whole number of at least 1');
  }
  flow.steps.forEach((s, index) => {
    const where = `step ${index + 1}`;
    const last = index === flow.steps.length - 1;
    if (s.kind === 'delay') {
      if (!(s.ms > 0)) problems.push(`${where}: delay must be positive`);
      if (last) problems.push(`${where}: a delay as the last step does nothing`);
      return;
    }
    if (s.kind === 'for_each_recipient') {
      if (s.steps.length === 0) problems.push(`${where}: no inner step`);
      s.steps.forEach((inner, i) => {
        problems.push(...sendProblems({ ...inner, to: 'each_in_turn' }, `${where}.${i + 1}`, flow));
      });
      return;
    }
    problems.push(...sendProblems(s, where, flow));
    // After the last step nothing follows, so a wait there only keeps the workflow open.
    // (`each_in_turn` still needs it between recipients.)
    if (last && s.waitMs !== null && s.to === 'all') {
      problems.push(`${where}: a wait on the last step has nothing to wait for`);
    }
  });
  return problems;
}

/**
 * A student's guardians (ROV-332): the app to all of them, then WhatsApp and SMS one guardian at
 * a time, at most two guardians. Guardians are not sent email.
 */
export function guardianAlertFlow(): NotificationFlow {
  return defineFlow({
    recipients: guardiansInOrder(),
    maxPaidRecipients: 2,
    steps: [
      step.app({ to: 'all', waitForArrival: '30 minutes' }),
      step.forEachRecipient([
        step.channel('WHATSAPP', { waitForArrival: '15 minutes' }),
        step.channel('SMS', { waitForArrival: '5 minutes' }),
      ]),
    ],
  });
}
