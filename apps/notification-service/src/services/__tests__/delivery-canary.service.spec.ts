import assert from 'node:assert';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelAttempt, ChannelSender } from '../../delivery/channel-sender';
import type { CanaryReadRepository } from '../../repositories/canary-read.repository';
import { NotificationMetrics } from '../../telemetry/notification-metrics';
import { DeliveryCanary } from '../delivery-canary.service';

const USER = '019a0000-0000-7000-8000-0000000000aa';
const AT = '2026-11-24T10:15:00.000Z';
const CANARY_ENV = {
  NOTIFICATION_CANARY_CHANNELS: 'EMAIL,PUSH,WHATSAPP',
  NOTIFICATION_CANARY_USER_ID: USER,
  NOTIFICATION_CANARY_EMAIL: 'canary@roviq.test',
  NOTIFICATION_CANARY_PHONE: '+919800000001',
};

function build(
  env: Record<string, string>,
  outcome: Awaited<ReturnType<ChannelSender['attempt']>>,
) {
  const attempt = vi.fn<ChannelSender['attempt']>().mockResolvedValue(outcome);
  const sender = createMock<ChannelSender>({ attempt });
  const canaries = createMock<CanaryReadRepository>({
    latestSentPerChannel: vi
      .fn()
      .mockResolvedValue([{ channel: 'EMAIL', sentAt: new Date('2026-11-24T09:00:00.000Z') }]),
  });
  const metrics = new NotificationMetrics();
  const canary = new DeliveryCanary(new ConfigService(env), sender, canaries, metrics);
  return { canary, attempt, metrics, canaries };
}

const SENT = { status: 'SENT', provider: 'smtp', providerMessageId: 'm-1' } as const;

describe('DeliveryCanary', () => {
  it('should send through the sender as a critical platform message to the configured address', async () => {
    const { canary, attempt } = build(CANARY_ENV, SENT);

    await canary.send('EMAIL', AT);

    expect(attempt).toHaveBeenCalledTimes(1);
    const [sent] = attempt.mock.calls[0] ?? [];
    assert(sent);
    const { compose, template, sms, ...rest } = sent;
    expect(rest).toEqual({
      type: 'DELIVERY_CANARY',
      channel: 'EMAIL',
      audience: { scope: 'platform', tenantId: null, resellerId: null },
      recipientUserId: USER,
      notificationId: null,
      flowId: null,
      channelEnabled: true,
      critical: true,
      digest: false,
      deferrable: false,
      attempt: 1,
      address: { given: 'canary@roviq.test' },
      data: {},
    } satisfies Omit<ChannelAttempt, 'compose' | 'template' | 'sms'>);
    expect(compose('en').subject).toBe('Roviq delivery check 24 Nov 2026, 15:45 IST');
  });

  it('should send WhatsApp with its approved template to the configured phone', async () => {
    const { canary, attempt } = build(CANARY_ENV, SENT);

    await canary.send('WHATSAPP', AT);

    const [sent] = attempt.mock.calls[0] ?? [];
    assert(sent?.template);
    expect(sent.address).toEqual({ given: '+919800000001' });
    expect(sent.template('en')).toEqual({
      name: 'delivery_canary_v1',
      languageCode: 'en',
      category: 'UTILITY',
      bodyVariables: ['24 Nov 2026, 15:45 IST'],
      buttonPath: 'login',
    });
  });

  it("should send push to the canary user's own devices", async () => {
    const { canary, attempt } = build(CANARY_ENV, SENT);

    await canary.send('PUSH', AT);

    expect(attempt.mock.calls[0]?.[0].address).toBe('lookup');
  });

  it('should move the gauge on a send the provider accepted', async () => {
    const { canary, metrics } = build(CANARY_ENV, SENT);
    const before = Math.floor(Date.now() / 1000);

    await canary.send('WHATSAPP', AT);

    expect(metrics.canaryLastSuccess('WHATSAPP')).toBeGreaterThanOrEqual(before);
  });

  it('should leave the gauge alone when the send failed', async () => {
    const { canary, metrics } = build(CANARY_ENV, {
      status: 'FAILED',
      provider: 'smtp',
      errorCode: 'EAUTH_535',
      retryable: true,
    });

    await canary.send('EMAIL', AT);

    expect(metrics.canaryLastSuccess('EMAIL')).toBeUndefined();
  });

  it('should send nothing for a channel that is not configured here', async () => {
    const { canary, attempt } = build(CANARY_ENV, SENT);

    await expect(canary.send('SMS', AT)).resolves.toBeNull();

    expect(attempt).not.toHaveBeenCalled();
  });

  it('should send nothing when the canary is off', async () => {
    const { canary, attempt } = build({}, SENT);

    await expect(canary.send('EMAIL', AT)).resolves.toBeNull();
    expect(attempt).not.toHaveBeenCalled();
  });

  it('should seed the gauge from the last SENT row, and from start for a channel never sent', async () => {
    const { canary, metrics } = build(CANARY_ENV, SENT);
    const before = Math.floor(Date.now() / 1000);

    await canary.onApplicationBootstrap();

    expect(metrics.canaryLastSuccess('EMAIL')).toBe(Date.parse('2026-11-24T09:00:00.000Z') / 1000);
    expect(metrics.canaryLastSuccess('PUSH')).toBeGreaterThanOrEqual(before);
    expect(metrics.canaryLastSuccess('WHATSAPP')).toBeGreaterThanOrEqual(before);
    expect(metrics.canaryLastSuccess('SMS')).toBeUndefined();
  });

  it('should read nothing at start when the canary is off', async () => {
    const { canary, canaries } = build({}, SENT);

    await canary.onApplicationBootstrap();

    expect(canaries.latestSentPerChannel).not.toHaveBeenCalled();
  });
});
