import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingSenderRepository } from '../../../repositories/messaging-sender.repository';
import { RecipientReadRepository } from '../../../repositories/recipient-read.repository';
import type { MessagingSenderRecord } from '../../../repositories/types';
import { CAP_RETRY_MS, Clock, WhatsAppRoute } from '../whatsapp-route';

const TENANT = '019a0000-0000-7000-8000-000000000001';
// 22:30 in India: inside quiet hours there.
const IST_NIGHT = new Date('2026-11-23T17:00:00.000Z');
// 11:30 in India, 06:00 in London.
const IST_MORNING = new Date('2026-11-23T06:00:00.000Z');
const IST_QUIET_END = new Date('2026-11-24T01:30:00.000Z');

const PLATFORM_SENDER: MessagingSenderRecord = {
  id: 'sender-platform',
  scope: 'platform',
  tenantId: null,
  status: 'ACTIVE',
  providerNumberId: 'fake-number-id-1',
  dailyCap: 100,
  instituteDailyCap: 10,
  accessTokenEncrypted: Buffer.from('fake-encrypted-token'),
};

const INSTITUTE_SENDER: MessagingSenderRecord = {
  ...PLATFORM_SENDER,
  id: 'sender-institute',
  scope: 'institute',
  tenantId: TENANT,
};

describe('WhatsAppRoute', () => {
  let senders: ReturnType<typeof createMock<MessagingSenderRepository>>;
  let recipients: ReturnType<typeof createMock<RecipientReadRepository>>;
  let clock: Clock;
  let route: WhatsAppRoute;

  const setNow = (at: Date) => vi.spyOn(clock, 'now').mockReturnValue(at);

  beforeEach(() => {
    senders = createMock<MessagingSenderRepository>({
      resolveForAudience: vi.fn().mockResolvedValue(INSTITUTE_SENDER),
      isOptedOut: vi.fn().mockResolvedValue(false),
      countSentSince: vi.fn().mockResolvedValue({ total: 0, forTenant: 0 }),
    });
    recipients = createMock<RecipientReadRepository>({
      findInstituteTimezone: vi.fn().mockResolvedValue('Asia/Kolkata'),
    });
    clock = new Clock();
    setNow(IST_NIGHT);
    route = new WhatsAppRoute(senders, recipients, clock);
  });

  describe('resolveSender', () => {
    it.each([TENANT, null])('should ask for the active cloud sender of %s', async (tenantId) => {
      await expect(route.resolveSender(tenantId)).resolves.toEqual(INSTITUTE_SENDER);

      expect(senders.resolveForAudience).toHaveBeenCalledWith(
        tenantId,
        'WHATSAPP',
        'whatsapp_cloud',
      );
    });
  });

  describe('optedOut', () => {
    it('should ask by the sender id and the phone', async () => {
      senders.isOptedOut.mockResolvedValue(true);

      await expect(route.optedOut(INSTITUTE_SENDER, '+919000000001')).resolves.toBe(true);

      expect(senders.isOptedOut).toHaveBeenCalledWith('sender-institute', '+919000000001');
    });
  });

  describe('quietUntil', () => {
    it('should let a critical message go at night without reading the timezone', async () => {
      await expect(route.quietUntil(TENANT, true)).resolves.toBeNull();

      expect(recipients.findInstituteTimezone).not.toHaveBeenCalled();
    });

    it('should hold a non-critical message until quiet hours end in the institute timezone', async () => {
      await expect(route.quietUntil(TENANT, false)).resolves.toEqual(IST_QUIET_END);

      expect(recipients.findInstituteTimezone).toHaveBeenCalledWith(TENANT);
    });

    it('should let a non-critical message go outside quiet hours', async () => {
      setNow(IST_MORNING);

      await expect(route.quietUntil(TENANT, false)).resolves.toBeNull();
    });

    it('should use the institute own timezone', async () => {
      recipients.findInstituteTimezone.mockResolvedValue('Europe/London');
      setNow(IST_MORNING);

      await expect(route.quietUntil(TENANT, false)).resolves.toEqual(
        new Date('2026-11-23T07:00:00.000Z'),
      );
    });

    it('should use Asia/Kolkata without an institute', async () => {
      await expect(route.quietUntil(null, false)).resolves.toEqual(IST_QUIET_END);

      expect(recipients.findInstituteTimezone).not.toHaveBeenCalled();
    });

    it('should use Asia/Kolkata for an institute without a stored timezone', async () => {
      recipients.findInstituteTimezone.mockResolvedValue(null);

      await expect(route.quietUntil(TENANT, false)).resolves.toEqual(IST_QUIET_END);
    });

    it('should fall back to Asia/Kolkata for a timezone the runtime does not know', async () => {
      recipients.findInstituteTimezone.mockResolvedValue('Mars/Olympus_Mons');

      await expect(route.quietUntil(TENANT, false)).resolves.toEqual(IST_QUIET_END);
    });
  });

  describe('capacity', () => {
    it('should count the last 24 hours from the clock', async () => {
      await route.capacity(INSTITUTE_SENDER, TENANT, false);

      expect(senders.countSentSince).toHaveBeenCalledWith(
        'sender-institute',
        new Date('2026-11-22T17:00:00.000Z'),
        TENANT,
      );
    });

    it('should be ok under the cap', async () => {
      senders.countSentSince.mockResolvedValue({ total: 99, forTenant: 99 });

      await expect(route.capacity(INSTITUTE_SENDER, TENANT, false)).resolves.toBe('ok');
    });

    it('should skip a non-critical message at the cap', async () => {
      senders.countSentSince.mockResolvedValue({ total: 100, forTenant: 0 });

      await expect(route.capacity(INSTITUTE_SENDER, TENANT, false)).resolves.toBe('over');
    });

    it('should hold a critical message at the cap for the retry interval', async () => {
      senders.countSentSince.mockResolvedValue({ total: 100, forTenant: 0 });

      await expect(route.capacity(INSTITUTE_SENDER, TENANT, true)).resolves.toEqual({
        deferUntil: new Date(IST_NIGHT.getTime() + CAP_RETRY_MS),
      });
    });

    it('should apply the institute share on the platform sender', async () => {
      senders.countSentSince.mockResolvedValue({ total: 50, forTenant: 10 });

      await expect(route.capacity(PLATFORM_SENDER, TENANT, false)).resolves.toBe('over');
    });

    it('should hold a critical message over the institute share', async () => {
      senders.countSentSince.mockResolvedValue({ total: 50, forTenant: 10 });

      await expect(route.capacity(PLATFORM_SENDER, TENANT, true)).resolves.toEqual({
        deferUntil: new Date(IST_NIGHT.getTime() + CAP_RETRY_MS),
      });
    });

    it('should be ok one message under the institute share', async () => {
      senders.countSentSince.mockResolvedValue({ total: 50, forTenant: 9 });

      await expect(route.capacity(PLATFORM_SENDER, TENANT, false)).resolves.toBe('ok');
    });

    it.each([
      ['an institute sender', INSTITUTE_SENDER, TENANT],
      [
        'a platform sender without a share',
        { ...PLATFORM_SENDER, instituteDailyCap: null },
        TENANT,
      ],
      ['a message without an institute', PLATFORM_SENDER, null],
    ])('should not apply an institute share to %s', async (_case, sender, tenantId) => {
      senders.countSentSince.mockResolvedValue({ total: 50, forTenant: 50 });

      await expect(route.capacity(sender, tenantId, false)).resolves.toBe('ok');
    });
  });
});
