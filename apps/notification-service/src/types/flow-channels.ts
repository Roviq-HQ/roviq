/**
 * The parts of a flow the workflow sandbox needs at run time. No runtime import beyond this
 * file: the sandbox bundle must not pull in `@roviq/common-types` (it imports NestJS).
 */
import type { NotificationChannel } from '@roviq/common-types';
import type { FlowStep, NotificationFlow, SendStep } from './flow';

/** Channels that cost money per message; a flow sends them to one recipient at a time. */
export const PAID_CHANNELS: ReadonlySet<NotificationChannel> = new Set(['WHATSAPP', 'SMS']);

/** Channels a guardian after the first is sent in a digest (ROV-328): the app, not paid ones. */
const NOT_APP_ONLY: ReadonlySet<NotificationChannel> = new Set([...PAID_CHANNELS, 'EMAIL']);

/** The flow without paid channels and email; a step left with no channel is dropped. */
export function appOnlyFlow(flow: NotificationFlow): NotificationFlow {
  const strip = (s: SendStep): SendStep | null => {
    const channels = s.channels.filter((channel) => !NOT_APP_ONLY.has(channel));
    return channels.length === 0 ? null : { ...s, channels };
  };
  const steps: FlowStep[] = [];
  for (const s of flow.steps) {
    if (s.kind === 'delay') steps.push(s);
    else if (s.kind === 'send') {
      const kept = strip(s);
      if (kept) steps.push(kept);
    } else {
      const inner = s.steps.map(strip).filter((one): one is SendStep => one !== null);
      if (inner.length > 0) steps.push({ ...s, steps: inner });
    }
  }
  return { ...flow, steps };
}
