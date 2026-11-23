import type { JetStreamContext } from '@roviq/nats-jetstream';
import type { AuthSecurityEvent } from '@roviq/notifications';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDispatcher } from '../../services/notification-dispatcher.service';
import { AuthListener, authAudience, displayIp } from '../auth.listener';

const TENANT = '019a0000-0000-7000-8000-000000000001';
const RESELLER = '019a0000-0000-7000-8000-000000000003';
const NOW = new Date('2026-04-10T05:00:00.000Z');

function event(overrides: Partial<AuthSecurityEvent> = {}): AuthSecurityEvent {
  return {
    userId: 'user-1',
    tenantId: TENANT,
    eventType: 'LOGIN',
    scope: 'institute',
    resellerId: null,
    metadata: { ip: '203.0.113.7' },
    ...overrides,
  };
}

describe('authAudience', () => {
  it('should place an institute login in that institute', () => {
    expect(authAudience(event())).toEqual({
      audience: { scope: 'institute', tenantId: TENANT, resellerId: null },
      inApp: true,
    });
  });

  it('should place a reseller login with the reseller', () => {
    expect(
      authAudience(event({ scope: 'reseller', tenantId: null, resellerId: RESELLER })),
    ).toEqual({
      audience: { scope: 'reseller', tenantId: null, resellerId: RESELLER },
      inApp: true,
    });
  });

  it('should place a platform login on the platform', () => {
    expect(authAudience(event({ scope: 'platform', tenantId: null }))).toEqual({
      audience: { scope: 'platform', tenantId: null, resellerId: null },
      inApp: true,
    });
  });

  it('should keep only delivery rows when the event names no portal', () => {
    expect(authAudience(event({ scope: undefined, tenantId: null }))).toEqual({
      audience: { scope: 'platform', tenantId: null, resellerId: null },
      inApp: false,
    });
  });
});

describe('AuthListener', () => {
  let dispatcher: ReturnType<typeof createMock<NotificationDispatcher>>;
  let listener: AuthListener;
  const ctx = createMock<JetStreamContext>({
    getStream: vi.fn().mockReturnValue('NOTIFICATION'),
    getSequence: vi.fn().mockReturnValue({ stream: 9, consumer: 1 }),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    dispatcher = createMock<NotificationDispatcher>({
      dispatch: vi.fn().mockResolvedValue(undefined),
      dispatchSecret: vi.fn().mockResolvedValue(undefined),
    });
    listener = new AuthListener(dispatcher);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should dispatch a login alert to the account page of its portal', async () => {
    await listener.handleSecurity(event(), ctx);

    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      message: {
        type: 'AUTH_LOGIN',
        params: { ip: '203.0.113.7', at: NOW.toISOString(), accountPath: '/institute/account' },
      },
      audience: { scope: 'institute', tenantId: TENANT, resellerId: null },
      recipients: [{ userId: 'user-1', membershipId: null }],
      recipientsRef: null,
      source: { stream: 'NOTIFICATION', sequence: 9 },
      inApp: true,
    });
  });

  it('should show an IPv4 address that arrives IPv6-mapped in its plain form', async () => {
    await listener.handleSecurity(event({ metadata: { ip: '::ffff:127.0.0.1' } }), ctx);

    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      message: {
        type: 'AUTH_LOGIN',
        params: { ip: '127.0.0.1', at: NOW.toISOString(), accountPath: '/institute/account' },
      },
      audience: { scope: 'institute', tenantId: TENANT, resellerId: null },
      recipients: [{ userId: 'user-1', membershipId: null }],
      recipientsRef: null,
      source: { stream: 'NOTIFICATION', sequence: 9 },
      inApp: true,
    });
  });

  it('should send the verification code only to the address the event names', async () => {
    await listener.handleSecurity(
      event({
        eventType: 'EMAIL_VERIFICATION',
        scope: 'platform',
        tenantId: null,
        metadata: { otp: '482913', recipientEmail: 'new-address@example.in' },
      }),
      ctx,
    );

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(dispatcher.dispatchSecret).toHaveBeenCalledWith({
      message: { type: 'EMAIL_VERIFICATION', params: { code: '482913' } },
      audience: { scope: 'platform', tenantId: null, resellerId: null },
      recipientUserId: 'user-1',
      addresses: { EMAIL: 'new-address@example.in' },
    });
  });

  it('should send the impersonation code to the named phone and look up the email', async () => {
    await listener.handleSecurity(
      event({
        eventType: 'IMPERSONATION_OTP',
        metadata: { otp: '771204', recipientPhone: '+919876543210' },
      }),
      ctx,
    );

    expect(dispatcher.dispatchSecret).toHaveBeenCalledWith({
      message: { type: 'IMPERSONATION_OTP', params: { otp: '771204' } },
      audience: { scope: 'institute', tenantId: TENANT, resellerId: null },
      recipientUserId: 'user-1',
      addresses: { SMS: '+919876543210' },
    });
  });

  it('should send nothing for a verification event without an address', async () => {
    await listener.handleSecurity(
      event({ eventType: 'EMAIL_VERIFICATION', metadata: { otp: '482913' } }),
      ctx,
    );

    expect(dispatcher.dispatchSecret).not.toHaveBeenCalled();
  });
});

describe('displayIp', () => {
  it.each([
    ['::ffff:127.0.0.1', '127.0.0.1'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['203.0.113.7', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1'],
    ['::ffff:7f00:1', '::ffff:7f00:1'],
    ['::1', '::1'],
  ])('should show %s as %s', (raw, shown) => {
    expect(displayIp(raw)).toBe(shown);
  });
});
