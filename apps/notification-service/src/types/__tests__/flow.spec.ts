import type { NotificationChannel } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import {
  channelsOf,
  defineFlow,
  durationMs,
  flowProblems,
  guardianAlertFlow,
  guardiansInOrder,
  type NotificationFlow,
  type SendStep,
  step,
} from '../flow';
import { REGULAR_TYPES } from '../registry';

describe('registered flows', () => {
  it.each(
    Object.values(REGULAR_TYPES).map((type) => [type.key, type.flow] as const),
  )('%s has a valid flow', (_key, flow) => {
    expect(flowProblems(flow)).toEqual([]);
  });

  it('should give the guardian alerts the guardian flow, without email', () => {
    for (const key of [
      'ATTENDANCE_ABSENT',
      'FEE_OVERDUE',
      'FEE_REMINDER',
      'LEAVE_DECIDED',
    ] as const) {
      expect(REGULAR_TYPES[key].flow).toEqual(guardianAlertFlow());
    }
    expect(channelsOf(guardianAlertFlow())).toEqual(['PUSH', 'WHATSAPP', 'SMS']);
  });

  it('should send approval and billing on all their channels at once', () => {
    expect(REGULAR_TYPES.APPROVAL_REQUESTED.flow.steps).toEqual([
      step.parallel(['WHATSAPP', 'EMAIL', 'PUSH']),
    ]);
    expect(REGULAR_TYPES.BILLING_EVENT.flow.steps).toEqual([step.parallel(['EMAIL', 'PUSH'])]);
  });
});

describe('flowProblems', () => {
  it('should refuse a missing flow', () => {
    expect(flowProblems(undefined)).toEqual(['the type has no flow']);
    expect(flowProblems(null)).toEqual(['the type has no flow']);
  });

  it('should refuse an empty flow', () => {
    expect(flowProblems(defineFlow({ steps: [] }))).toEqual(['the flow has no step']);
  });

  it('should refuse an unknown channel', () => {
    const unknown: SendStep = {
      ...step.channel('EMAIL'),
      channels: ['FAX' as NotificationChannel],
    };

    expect(flowProblems(defineFlow({ steps: [unknown] }))).toEqual([
      'step 1: unknown channel "FAX"',
    ]);
  });

  it('should refuse a wait on the last step', () => {
    const flow = defineFlow({
      steps: [
        step.app({ waitForArrival: '2 minutes' }),
        step.channel('EMAIL', { waitForArrival: '1 minute' }),
      ],
    });

    expect(flowProblems(flow)).toEqual(['step 2: a wait on the last step has nothing to wait for']);
  });

  it('should refuse a paid channel sent to all of several recipients', () => {
    const flow = defineFlow({
      recipients: guardiansInOrder(),
      steps: [step.parallel(['PUSH', 'WHATSAPP'])],
    });

    expect(flowProblems(flow)).toEqual([
      'step 1: a paid channel must go to one recipient at a time',
    ]);
  });

  it('should accept a paid channel sent to the one recipient of the event', () => {
    expect(flowProblems(defineFlow({ steps: [step.channel('WHATSAPP')] }))).toEqual([]);
  });

  it('should refuse a send step with no channel unless it is the in-app step alone', () => {
    const none: NotificationFlow = defineFlow({
      steps: [{ ...step.channel('EMAIL'), channels: [] }],
    });

    expect(flowProblems(none)).toEqual(['step 1: no channel']);
    expect(flowProblems(defineFlow({ steps: [step.inAppOnly()] }))).toEqual([]);
  });

  it('should refuse a paid recipient limit below one', () => {
    const flow = defineFlow({ maxPaidRecipients: 0, steps: [step.app()] });

    expect(flowProblems(flow)).toEqual(['maxPaidRecipients must be a whole number of at least 1']);
  });
});

describe('durationMs', () => {
  it('should turn a duration into milliseconds and refuse a non-positive one', () => {
    expect(durationMs('30 minutes')).toBe(1_800_000);
    expect(durationMs('2 hours')).toBe(7_200_000);
    expect(() => durationMs('0 minutes')).toThrow('Invalid flow duration "0 minutes"');
  });
});
