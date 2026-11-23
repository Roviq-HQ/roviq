import type { NotificationChannel } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import {
  defineFlow,
  guardianAlertFlow,
  guardiansInOrder,
  type NotificationFlow,
  step,
} from '../../types/flow';
import { REGULAR_TYPES } from '../../types/registry';
import { type FlowRunnerDeps, type FlowSkipReason, runFlow, type SendResult } from '../flow-runner';

type Event =
  | { kind: 'send'; to: string; channel: NotificationChannel }
  | { kind: 'wait'; ms: number }
  | { kind: 'sleep'; ms: number }
  | { kind: 'skip'; to: string; channel: NotificationChannel; reason: FlowSkipReason };

const MIN = 60_000;
const GUARDIANS = ['g1', 'g2', 'g3'];
const CONDITIONS = { type_is_critical: false, audience_is_institute: true };

interface Script {
  /** The answer of one send; SENT when not listed. A throw counts as FAILED. */
  result?: (to: string, channel: NotificationChannel) => SendResult | 'THROW';
  /** Arrival comes during the wait after this send (by index of send events, 0-based). */
  arriveDuringWaitAfterSend?: number;
}

/** Runs a flow with recording deps; arrival is simulated inside a chosen wait. */
async function run(flow: NotificationFlow, recipients: string[], script: Script = {}) {
  const events: Event[] = [];
  let arrived = false;
  let sends = 0;
  const deps: FlowRunnerDeps<string> = {
    send: async (to, channel) => {
      events.push({ kind: 'send', to, channel });
      sends += 1;
      const result = script.result?.(to, channel) ?? 'SENT';
      if (result === 'THROW') throw new Error('activity failed after its retries');
      return result;
    },
    waitForArrival: async (ms) => {
      events.push({ kind: 'wait', ms });
      if (
        script.arriveDuringWaitAfterSend !== undefined &&
        sends - 1 >= script.arriveDuringWaitAfterSend
      ) {
        arrived = true;
      }
      return arrived;
    },
    arrived: () => arrived,
    sleep: async (ms) => {
      events.push({ kind: 'sleep', ms });
    },
    recordSkip: async (to, channel, reason) => {
      events.push({ kind: 'skip', to, channel, reason });
    },
  };
  await runFlow({ flow, recipients, conditions: CONDITIONS }, deps);
  return events;
}

const send = (to: string, channel: NotificationChannel): Event => ({ kind: 'send', to, channel });
const wait = (minutes: number): Event => ({ kind: 'wait', ms: minutes * MIN });
const skip = (to: string, channel: NotificationChannel, reason: FlowSkipReason): Event => ({
  kind: 'skip',
  to,
  channel,
  reason,
});

describe('runFlow: the guardian flow', () => {
  it('should send the app to all, then WhatsApp and SMS one guardian at a time, waiting after each', async () => {
    const events = await run(guardianAlertFlow(), ['g1', 'g2']);

    expect(events).toEqual([
      send('g1', 'PUSH'),
      send('g2', 'PUSH'),
      wait(30),
      send('g1', 'WHATSAPP'),
      wait(15),
      send('g1', 'SMS'),
      wait(5),
      send('g2', 'WHATSAPP'),
      wait(15),
      // The last send of the flow: nothing follows to wait for.
      send('g2', 'SMS'),
    ]);
  });

  it('should leave a third guardian untried on paid channels, with no row at all', async () => {
    const events = await run(guardianAlertFlow(), GUARDIANS);

    expect(events.filter((e) => e.kind !== 'wait')).toEqual([
      send('g1', 'PUSH'),
      send('g2', 'PUSH'),
      send('g3', 'PUSH'),
      send('g1', 'WHATSAPP'),
      send('g1', 'SMS'),
      send('g2', 'WHATSAPP'),
      send('g2', 'SMS'),
    ]);
  });

  it('should move on at once when no push was sent (no device token)', async () => {
    const events = await run(guardianAlertFlow(), ['g1'], {
      result: (_to, channel) => (channel === 'PUSH' ? 'SKIPPED' : 'SENT'),
    });

    expect(events).toEqual([
      send('g1', 'PUSH'),
      send('g1', 'WHATSAPP'),
      wait(15),
      send('g1', 'SMS'),
    ]);
  });

  it('should move on at once after a skipped or failed paid send', async () => {
    const events = await run(guardianAlertFlow(), ['g1', 'g2'], {
      result: (to, channel) =>
        to === 'g1' && channel === 'WHATSAPP'
          ? 'SKIPPED'
          : to === 'g1' && channel === 'SMS'
            ? 'THROW'
            : 'SENT',
    });

    expect(events).toEqual([
      send('g1', 'PUSH'),
      send('g2', 'PUSH'),
      wait(30),
      send('g1', 'WHATSAPP'),
      send('g1', 'SMS'),
      send('g2', 'WHATSAPP'),
      wait(15),
      send('g2', 'SMS'),
    ]);
  });

  it('should end when someone is reached during a wait, and record the rest as not needed', async () => {
    // Arrival during the wait after the first guardian's WhatsApp (the third send).
    const events = await run(guardianAlertFlow(), GUARDIANS, { arriveDuringWaitAfterSend: 3 });

    expect(events).toEqual([
      send('g1', 'PUSH'),
      send('g2', 'PUSH'),
      send('g3', 'PUSH'),
      wait(30),
      send('g1', 'WHATSAPP'),
      wait(15),
      skip('g1', 'SMS', 'not_needed'),
      skip('g2', 'WHATSAPP', 'not_needed'),
      skip('g2', 'SMS', 'not_needed'),
    ]);
  });

  it('should end after the app step when the app copy is read, sending no paid message', async () => {
    const events = await run(guardianAlertFlow(), ['g1', 'g2'], { arriveDuringWaitAfterSend: 0 });

    expect(events).toEqual([
      send('g1', 'PUSH'),
      send('g2', 'PUSH'),
      wait(30),
      skip('g1', 'WHATSAPP', 'not_needed'),
      skip('g1', 'SMS', 'not_needed'),
      skip('g2', 'WHATSAPP', 'not_needed'),
      skip('g2', 'SMS', 'not_needed'),
    ]);
  });
});

describe('runFlow: other shapes', () => {
  it('should let arrival on any channel of a parallel step satisfy it', async () => {
    const flow = defineFlow({
      steps: [
        step.parallel(['PUSH', 'EMAIL'], { waitForArrival: '10 minutes' }),
        step.channel('WHATSAPP'),
      ],
    });

    const events = await run(flow, ['u1'], {
      result: (_to, channel) => (channel === 'EMAIL' ? 'SENT' : 'FAILED'),
      arriveDuringWaitAfterSend: 0,
    });

    expect(events).toEqual([
      send('u1', 'PUSH'),
      send('u1', 'EMAIL'),
      wait(10),
      skip('u1', 'WHATSAPP', 'not_needed'),
    ]);
  });

  it('should record a step whose condition is false as condition_not_met, without sending', async () => {
    const flow = defineFlow({
      steps: [
        step.app({ waitForArrival: '1 minute' }),
        step.channel('EMAIL', { onlyIf: 'type_is_critical' }),
      ],
    });

    const events = await run(flow, ['u1']);

    // The app step is the last send that happens, so it does not wait.
    expect(events).toEqual([send('u1', 'PUSH'), skip('u1', 'EMAIL', 'condition_not_met')]);
  });

  it('should send a top-level each_in_turn step channel first, one recipient at a time', async () => {
    const flow = defineFlow({
      recipients: guardiansInOrder(),
      steps: [
        step.channel('WHATSAPP', { to: 'each_in_turn', waitForArrival: '15 minutes' }),
        step.channel('SMS', { to: 'each_in_turn', waitForArrival: '5 minutes' }),
      ],
    });

    const events = await run(flow, ['g1', 'g2']);

    expect(events).toEqual([
      send('g1', 'WHATSAPP'),
      wait(15),
      send('g2', 'WHATSAPP'),
      wait(15),
      send('g1', 'SMS'),
      wait(5),
      send('g2', 'SMS'),
    ]);
  });

  it('should sleep through a delay step', async () => {
    const flow = defineFlow({ steps: [step.app(), step.delay('1 hour'), step.channel('EMAIL')] });

    expect(await run(flow, ['u1'])).toEqual([
      send('u1', 'PUSH'),
      { kind: 'sleep', ms: 60 * MIN },
      send('u1', 'EMAIL'),
    ]);
  });

  it('should run two different flows through the same function', async () => {
    const parallel = await run(REGULAR_TYPES.APPROVAL_REQUESTED.flow, ['u1']);
    const chain = await run(REGULAR_TYPES.AUTH_NEW_DEVICE.flow, ['u1']);

    expect(parallel).toEqual([send('u1', 'WHATSAPP'), send('u1', 'EMAIL'), send('u1', 'PUSH')]);
    expect(chain).toEqual([
      send('u1', 'PUSH'),
      wait(2),
      send('u1', 'WHATSAPP'),
      wait(2),
      send('u1', 'EMAIL'),
    ]);
  });

  it("should use a critical type's two-minute waits", async () => {
    const events = await run(REGULAR_TYPES.AUTH_ACCOUNT_LOCKED.flow, ['u1']);

    expect(events).toEqual([send('u1', 'PUSH'), wait(2), send('u1', 'EMAIL')]);
  });

  it('should send nothing for the in-app step alone', async () => {
    expect(await run(REGULAR_TYPES.AUTH_LOGIN.flow, ['u1'])).toEqual([]);
  });
});
