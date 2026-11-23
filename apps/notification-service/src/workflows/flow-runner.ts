/**
 * Walks a notification flow (ROV-332) without Temporal, so it can be tested directly. Must stay
 * deterministic: it runs inside the workflow sandbox.
 */
import type { NotificationChannel } from '@roviq/common-types';
import type { FlowCondition, NotificationFlow, SendStep } from '../types/flow';
import { PAID_CHANNELS } from '../types/flow-channels';

export type SendResult = 'SENT' | 'SKIPPED' | 'FAILED';
export type FlowSkipReason = 'not_needed' | 'condition_not_met';

export interface FlowRunnerDeps<R> {
  /** One channel to one recipient, deferrals included; a throw counts as FAILED. */
  send(recipient: R, channel: NotificationChannel): Promise<SendResult>;
  /** Waits up to `ms` for arrival; true when it came. */
  waitForArrival(ms: number): Promise<boolean>;
  /** Any recipient of this flow was reached on any channel, or read the in-app copy. */
  arrived(): boolean;
  sleep(ms: number): Promise<void>;
  recordSkip(recipient: R, channel: NotificationChannel, reason: FlowSkipReason): Promise<void>;
}

export interface RunFlowInput<R> {
  flow: NotificationFlow;
  /** In alert order. */
  recipients: readonly R[];
  conditions: Record<FlowCondition, boolean>;
}

interface Pair<R> {
  recipient: R;
  channel: NotificationChannel;
}

/** One group of sends made together, then an optional wait for arrival. */
type Unit<R> =
  | { kind: 'send'; pairs: Pair<R>[]; waitMs: number | null; active: boolean }
  | { kind: 'delay'; ms: number };

function pairsOf<R>(s: SendStep, recipients: readonly R[]): Pair<R>[] {
  return recipients.flatMap((recipient) => s.channels.map((channel) => ({ recipient, channel })));
}

/** The flow as the ordered list of sends it makes when nobody is reached. */
function unitsOf<R>(input: RunFlowInput<R>): Unit<R>[] {
  const { flow, recipients, conditions } = input;
  const limited =
    flow.maxPaidRecipients === null ? recipients : recipients.slice(0, flow.maxPaidRecipients);
  const active = (s: SendStep) => s.onlyIf === null || conditions[s.onlyIf];
  const sendUnit = (s: SendStep, to: readonly R[]): Unit<R> => ({
    kind: 'send',
    // A paid channel never goes past the limit, whichever way the step is sent.
    pairs: pairsOf(s, to).filter(
      (pair) => !PAID_CHANNELS.has(pair.channel) || limited.includes(pair.recipient),
    ),
    waitMs: s.waitMs,
    active: active(s),
  });

  const units: Unit<R>[] = [];
  for (const s of flow.steps) {
    if (s.kind === 'delay') units.push({ kind: 'delay', ms: s.ms });
    else if (s.kind === 'for_each_recipient') {
      for (const recipient of limited) {
        for (const inner of s.steps) units.push(sendUnit(inner, [recipient]));
      }
    } else if (s.to === 'each_in_turn') {
      for (const recipient of limited) units.push(sendUnit(s, [recipient]));
    } else {
      units.push(sendUnit(s, recipients));
    }
  }
  return units;
}

/**
 * Sends step by step and ends as soon as anyone is reached. A step that sent nothing moves on
 * at once; a step that sent waits its time for arrival, except after the flow's last send.
 * Pairs not tried because the flow ended are recorded `not_needed`; a step whose condition is
 * false is recorded `condition_not_met`.
 */
export async function runFlow<R>(input: RunFlowInput<R>, deps: FlowRunnerDeps<R>): Promise<void> {
  const units = unitsOf(input);
  let lastSend = -1;
  units.forEach((u, i) => {
    if (u.kind === 'send' && u.active && u.pairs.length > 0) lastSend = i;
  });

  for (const [index, unit] of units.entries()) {
    if (deps.arrived()) {
      await recordRest(units.slice(index), deps);
      return;
    }
    if (unit.kind === 'delay') {
      await deps.sleep(unit.ms);
      continue;
    }
    if (!unit.active) {
      for (const pair of unit.pairs) {
        await deps.recordSkip(pair.recipient, pair.channel, 'condition_not_met');
      }
      continue;
    }
    if (unit.pairs.length === 0) continue;
    const results = await Promise.allSettled(
      unit.pairs.map((pair) => deps.send(pair.recipient, pair.channel)),
    );
    const sent = results.some((r) => r.status === 'fulfilled' && r.value === 'SENT');
    if (sent && unit.waitMs !== null && index < lastSend) await deps.waitForArrival(unit.waitMs);
  }
}

async function recordRest<R>(rest: Unit<R>[], deps: FlowRunnerDeps<R>): Promise<void> {
  for (const unit of rest) {
    if (unit.kind === 'delay') continue;
    const reason: FlowSkipReason = unit.active ? 'not_needed' : 'condition_not_met';
    for (const pair of unit.pairs) await deps.recordSkip(pair.recipient, pair.channel, reason);
  }
}
