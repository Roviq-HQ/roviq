import { createHmac } from 'node:crypto';
import {
  ForbiddenException,
  NotFoundException,
  type RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppCloud } from '../../delivery/whatsapp/whatsapp-cloud';
import { WhatsAppWebhookService } from '../../services/whatsapp-webhook.service';
import { WhatsAppWebhookController } from '../whatsapp-webhook.controller';

const APP_SECRET = 'fake-app-secret';
const VERIFY_TOKEN = 'fake-verify-token';
const NUMBER_ID = 'fake-number-id-1';

const BODY = Buffer.from(
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'fake-account-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: NUMBER_ID },
              statuses: [{ id: 'wamid.fake-1', status: 'delivered', recipient_id: '919000000001' }],
            },
          },
        ],
      },
    ],
  }),
  'utf8',
);

const sign = (body: Buffer, secret = APP_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const request = (rawBody: Buffer | undefined) => createMock<RawBodyRequest<Request>>({ rawBody });

function cloud(provider: 'cloud' | 'log') {
  return new WhatsAppCloud(
    new ConfigService(
      provider === 'cloud'
        ? {
            NOTIFICATION_WHATSAPP_PROVIDER: 'cloud',
            WHATSAPP_API_BASE_URL: 'https://graph.example.test/v99.0',
            WHATSAPP_APP_SECRET: APP_SECRET,
            WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
            MESSAGING_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
          }
        : { NOTIFICATION_WHATSAPP_PROVIDER: 'log' },
    ),
  );
}

describe('WhatsAppWebhookController', () => {
  let service: ReturnType<typeof createMock<WhatsAppWebhookService>>;
  let controller: WhatsAppWebhookController;

  beforeEach(() => {
    service = createMock<WhatsAppWebhookService>({ handle: vi.fn().mockResolvedValue(undefined) });
    controller = new WhatsAppWebhookController(cloud('cloud'), service);
  });

  describe('verify', () => {
    it('should echo the challenge for the right mode and token', () => {
      expect(controller.verify('subscribe', VERIFY_TOKEN, 'fake-challenge-123')).toBe(
        'fake-challenge-123',
      );
    });

    it('should not exist when the provider is not configured', () => {
      controller = new WhatsAppWebhookController(cloud('log'), service);

      expect(() => controller.verify('subscribe', VERIFY_TOKEN, 'fake-challenge-123')).toThrow(
        NotFoundException,
      );
    });

    it.each([
      ['a wrong mode', 'unsubscribe', VERIFY_TOKEN, 'fake-challenge-123'],
      ['no mode', undefined, VERIFY_TOKEN, 'fake-challenge-123'],
      ['a wrong token', 'subscribe', 'another-fake-token', 'fake-challenge-123'],
      ['no token', 'subscribe', undefined, 'fake-challenge-123'],
      ['no challenge', 'subscribe', VERIFY_TOKEN, undefined],
      ['an empty challenge', 'subscribe', VERIFY_TOKEN, ''],
    ])('should refuse %s', (_case, mode, token, challenge) => {
      expect(() => controller.verify(mode, token, challenge)).toThrow(ForbiddenException);
    });
  });

  describe('receive', () => {
    it('should hand a correctly signed body to the service, parsed', async () => {
      await expect(controller.receive(request(BODY), sign(BODY))).resolves.toBe('ok');

      expect(service.handle).toHaveBeenCalledWith([
        {
          providerNumberId: NUMBER_ID,
          receipts: [
            {
              messageId: 'wamid.fake-1',
              status: 'delivered',
              recipientPhone: '+919000000001',
              providerUserId: null,
              providerErrorCode: null,
            },
          ],
          messages: [],
        },
      ]);
    });

    it('should not exist when the provider is not configured', async () => {
      controller = new WhatsAppWebhookController(cloud('log'), service);

      await expect(controller.receive(request(BODY), sign(BODY))).rejects.toThrow(
        NotFoundException,
      );
      expect(service.handle).not.toHaveBeenCalled();
    });

    it.each([
      ['no raw body', undefined, sign(BODY)],
      ['no signature', BODY, undefined],
      ['a signature with another secret', BODY, sign(BODY, 'another-fake-secret')],
      ['a signature of another body', BODY, sign(Buffer.from('{}'))],
    ])('should refuse a call with %s before reading it', async (_case, rawBody, signature) => {
      await expect(controller.receive(request(rawBody), signature)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(service.handle).not.toHaveBeenCalled();
    });

    it('should ignore a correctly signed body that is not JSON', async () => {
      const text = Buffer.from('not json', 'utf8');

      await expect(controller.receive(request(text), sign(text))).resolves.toBe('ignored');
      expect(service.handle).not.toHaveBeenCalled();
    });

    it('should let a service error propagate so the provider sends again', async () => {
      service.handle.mockRejectedValue(new Error('connection terminated'));

      await expect(controller.receive(request(BODY), sign(BODY))).rejects.toThrow(
        'connection terminated',
      );
    });
  });
});
