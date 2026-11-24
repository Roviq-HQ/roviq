import type { InstituteContext, PlatformContext, ResellerContext } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { feedEventOf } from '../notification-inbox.consumer';
import { NotificationInboxService } from '../notification-inbox.service';
import {
  assertOwnSession,
  assertValidDeviceToken,
  DEVICE_TOKEN_MAX_LENGTH,
  notificationViewerOf,
} from '../notification-viewer';
import { ownFeedIterator } from '../own-feed-iterator';
import { DeviceTokenRepository } from '../repositories/device-token.repository';
import { NotificationInboxRepository } from '../repositories/notification-inbox.repository';

const USER = '019a0000-0000-7000-8000-000000000001';
const MEMBERSHIP = '019a0000-0000-7000-8000-000000000002';
const ROLE = '019a0000-0000-7000-8000-000000000003';
const TENANT = '019a0000-0000-7000-8000-000000000004';
const RESELLER = '019a0000-0000-7000-8000-000000000005';
const NOTIFICATION = '019a0000-0000-7000-8000-000000000006';

const base = { userId: USER, membershipId: MEMBERSHIP, roleId: ROLE, type: 'access' as const };
const institute: InstituteContext = {
  ...base,
  _scope: 'institute',
  scope: 'institute',
  tenantId: TENANT,
  resellerId: RESELLER,
};
const reseller: ResellerContext = {
  ...base,
  _scope: 'reseller',
  scope: 'reseller',
  resellerId: RESELLER,
};
const platform: PlatformContext = { ...base, _scope: 'platform', scope: 'platform' };
const impersonated: InstituteContext = {
  ...institute,
  isImpersonated: true,
  impersonatorId: '019a0000-0000-7000-8000-000000000007',
  impersonationSessionId: '019a0000-0000-7000-8000-000000000008',
};

describe('notificationViewerOf', () => {
  it('should take institute, user and membership from an institute token', () => {
    expect(notificationViewerOf(institute)).toEqual({
      scope: 'institute',
      ctx: institute,
      userId: USER,
      tenantId: TENANT,
      membershipId: MEMBERSHIP,
    });
  });

  it('should take reseller and user from a reseller token, ignoring membership', () => {
    expect(notificationViewerOf(reseller)).toEqual({
      scope: 'reseller',
      ctx: reseller,
      userId: USER,
      resellerId: RESELLER,
    });
  });

  it('should take only the user from a platform token', () => {
    expect(notificationViewerOf(platform)).toEqual({
      scope: 'platform',
      ctx: platform,
      userId: USER,
    });
  });

  it('should refuse an institute token without an institute', () => {
    expect(() => notificationViewerOf({ ...institute, tenantId: '' })).toThrow(
      'Institute scope required',
    );
  });

  it('should refuse a reseller token without a reseller', () => {
    expect(() => notificationViewerOf({ ...reseller, resellerId: '' })).toThrow(
      'Reseller scope required',
    );
  });
});

describe('assertOwnSession', () => {
  it('should let the account holder through', () => {
    expect(() => assertOwnSession(institute)).not.toThrow();
  });

  it('should refuse an impersonated session', () => {
    expect(() => assertOwnSession(impersonated)).toThrow(
      'Notifications and devices cannot be changed while impersonating',
    );
  });
});

describe('assertValidDeviceToken', () => {
  it('should accept a token at the length limit', () => {
    expect(() => assertValidDeviceToken('a'.repeat(DEVICE_TOKEN_MAX_LENGTH))).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'a'.repeat(DEVICE_TOKEN_MAX_LENGTH + 1)],
  ])('should refuse a %s token', (_label, token) => {
    expect(() => assertValidDeviceToken(token)).toThrow('Invalid device token');
  });
});

describe('NotificationInboxService writes', () => {
  function build() {
    const inbox = createMock<NotificationInboxRepository>();
    const devices = createMock<DeviceTokenRepository>();
    const eventBus = createMock<EventBusService>({ emit: vi.fn() });
    return {
      inbox,
      devices,
      eventBus,
      service: new NotificationInboxService(inbox, devices, eventBus),
    };
  }

  it.each([
    ['markRead', (s: NotificationInboxService) => s.markRead(impersonated, NOTIFICATION)],
    ['markAllRead', (s: NotificationInboxService) => s.markAllRead(impersonated)],
    ['archive', (s: NotificationInboxService) => s.archive(impersonated, NOTIFICATION)],
    [
      'acknowledgeDelivery',
      (s: NotificationInboxService) => s.acknowledgeDelivery(impersonated, NOTIFICATION),
    ],
    [
      'registerDeviceToken',
      (s: NotificationInboxService) => s.registerDeviceToken(impersonated, 'fcm-token', 'WEB'),
    ],
    [
      'unregisterDeviceToken',
      (s: NotificationInboxService) => s.unregisterDeviceToken(impersonated, 'fcm-token'),
    ],
  ])('should refuse %s in an impersonated session before touching the database', async (_name, call) => {
    const { inbox, devices, eventBus, service } = build();

    await expect(call(service)).rejects.toThrow(
      'Notifications and devices cannot be changed while impersonating',
    );

    expect(inbox.markRead).not.toHaveBeenCalled();
    expect(inbox.markAllRead).not.toHaveBeenCalled();
    expect(inbox.archive).not.toHaveBeenCalled();
    expect(inbox.findOne).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(devices.register).not.toHaveBeenCalled();
    expect(devices.unregister).not.toHaveBeenCalled();
  });

  it('should answer a malformed id like a missing one', async () => {
    const { inbox, service } = build();

    await expect(service.markRead(institute, 'not-a-uuid')).rejects.toThrow(
      'Notification not found',
    );
    expect(inbox.markRead).not.toHaveBeenCalled();
  });

  it('should register a device under the token user only', async () => {
    const { devices, service } = build();

    await expect(service.registerDeviceToken(reseller, 'fcm-token', 'ANDROID')).resolves.toBe(true);
    expect(devices.register).toHaveBeenCalledWith(USER, 'fcm-token', 'ANDROID');
  });
});

describe('feedEventOf', () => {
  const packet = (data: unknown) => JSON.stringify({ pattern: 'NOTIFICATION.inapp.created', data });

  it('should keep only the notification id and the recipient', () => {
    const raw = packet({
      notificationId: NOTIFICATION,
      scope: 'institute',
      tenantId: TENANT,
      resellerId: null,
      recipientUserId: USER,
    });

    expect(feedEventOf(raw)).toEqual({
      recipientUserId: USER,
      event: { notificationId: NOTIFICATION },
    });
  });

  it.each([
    ['not JSON', '{'],
    ['no envelope', JSON.stringify({ notificationId: NOTIFICATION, recipientUserId: USER })],
    ['no recipient', packet({ notificationId: NOTIFICATION })],
    ['a non-uuid id', packet({ notificationId: 'x', recipientUserId: USER })],
  ])('should drop %s', (_label, raw) => {
    expect(feedEventOf(raw)).toBeNull();
  });
});

describe('ownFeedIterator', () => {
  async function* events(ids: string[]) {
    for (const id of ids) yield id;
  }

  it('should yield only events the loader resolves', async () => {
    const load = vi.fn(async (id: string) => (id === 'mine' ? { id } : null));
    const seen: { id: string }[] = [];

    for await (const row of ownFeedIterator(events(['other', 'mine', 'other']), load)) {
      seen.push(row);
    }

    expect(seen).toEqual([{ id: 'mine' }]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('should close the source when the subscriber leaves', async () => {
    const source = events(['mine', 'mine']);
    const closeSource = vi.spyOn(source, 'return');
    const iterator = ownFeedIterator(source, async (id: string) => ({ id }));

    await iterator.next();
    await iterator.return?.();

    expect(closeSource).toHaveBeenCalledTimes(1);
  });

  it('should end instead of pulling again when closed while a row is loading', async () => {
    const source = events(['other', 'other']);
    const pull = vi.spyOn(source, 'next');
    let finishLoad: (value: null) => void = () => undefined;
    const iterator = ownFeedIterator(
      source,
      () =>
        new Promise<{ id: string } | null>((resolve) => {
          finishLoad = resolve;
        }),
    );

    const pending = iterator.next();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
    await iterator.return?.();
    finishLoad(null);

    expect(await pending).toEqual({ done: true, value: undefined });
    expect(pull).toHaveBeenCalledTimes(1);
  });
});
