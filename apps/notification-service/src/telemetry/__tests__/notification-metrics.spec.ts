import { describe, expect, it } from 'vitest';
import {
  deliveryAttributes,
  NOTIFICATION_INSTRUMENTS,
  NOTIFICATION_METRIC_LABELS,
  NotificationMetrics,
  reasonLabel,
} from '../notification-metrics';

/** The only label names a notification metric may carry; none can hold a person or an institute. */
const ALLOWED_LABELS = ['channel', 'status', 'provider', 'reason', 'stream', 'consumer'];

describe('notification metric labels', () => {
  it('should keep the label constant to the allowlist', () => {
    expect(Object.values(NOTIFICATION_METRIC_LABELS).sort()).toEqual([...ALLOWED_LABELS].sort());
  });

  it('should give each instrument exactly its listed labels', () => {
    const used = Object.fromEntries(
      Object.values(NOTIFICATION_INSTRUMENTS).map((i) => [i.name, [...i.labels]]),
    );

    expect(used).toEqual({
      'notification.delivery': ['channel', 'status', 'provider', 'reason'],
      'notification.delivery.duration': ['channel', 'provider'],
      'notification.deferred': ['channel', 'reason'],
      'notification.breaker.opened': ['channel', 'provider', 'reason'],
      'notification.breaker.open': ['channel', 'provider'],
      'notification.sender.blocked': ['channel'],
      'notification.skipped.recent': ['channel', 'reason'],
      'notification.template.problems': ['reason'],
      'notification.event.lag': ['stream', 'consumer'],
      'notification.canary.last_success': ['channel'],
      'notification.worker.running': [],
    });
    for (const labels of Object.values(used)) {
      for (const label of labels) expect(ALLOWED_LABELS).toContain(label);
    }
  });

  it('should build delivery attributes with only the delivery labels', () => {
    const attrs = deliveryAttributes({
      channel: 'EMAIL',
      status: 'FAILED',
      provider: 'smtp',
      reason: 'EAUTH_535',
    });

    expect(attrs).toEqual({
      channel: 'EMAIL',
      status: 'FAILED',
      provider: 'smtp',
      reason: 'EAUTH',
    });
    expect(Object.keys(attrs)).toEqual([...NOTIFICATION_INSTRUMENTS.delivery.labels]);
  });

  it('should label a row without a provider as none', () => {
    expect(
      deliveryAttributes({
        channel: 'SMS',
        status: 'SKIPPED',
        provider: null,
        reason: 'no_provider',
      }),
    ).toEqual({ channel: 'SMS', status: 'SKIPPED', provider: 'none', reason: 'no_provider' });
  });
});

describe('reasonLabel', () => {
  it.each([
    ['EAUTH_535', 'EAUTH'],
    ['ECONNECTION_421', 'ECONNECTION'],
    ['EAUTH', 'EAUTH'],
    ['WA_SENDER_BLOCKED', 'WA_SENDER_BLOCKED'],
    ['SMS_SENDER_BLOCKED', 'SMS_SENDER_BLOCKED'],
    ['UNREGISTERED', 'UNREGISTERED'],
    ['no_template', 'no_template'],
    ['quiet_hours', 'quiet_hours'],
    ['sender_cap', 'sender_cap'],
    ['rate_limited', 'rate_limited'],
    ['provider_paused', 'provider_paused'],
  ])('should label %s as %s', (code, label) => {
    expect(reasonLabel(code)).toBe(label);
  });

  it('should label no reason as none', () => {
    expect(reasonLabel(null)).toBe('none');
    expect(reasonLabel('')).toBe('none');
  });

  it('should keep a code outside the adapter table out of the label', () => {
    expect(reasonLabel('+919800000000')).toBe('other');
    expect(reasonLabel('provider said: user 42 unknown')).toBe('other');
  });
});

describe('NotificationMetrics canary gauge', () => {
  it('should keep the latest success per channel', () => {
    const metrics = new NotificationMetrics();

    metrics.canarySucceeded('EMAIL', new Date('2026-11-24T10:15:00.000Z'));
    metrics.canarySucceeded('EMAIL', new Date('2026-11-24T10:00:00.000Z'));

    expect(metrics.canaryLastSuccess('EMAIL')).toBe(Date.parse('2026-11-24T10:15:00.000Z') / 1000);
    expect(metrics.canaryLastSuccess('SMS')).toBeUndefined();
  });
});
