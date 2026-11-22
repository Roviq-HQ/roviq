import assert from 'node:assert';
import { Controller, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventPattern, type MessageHandler } from '@nestjs/microservices';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectJetStreamMicroservice } from '../connect';
import { deadLetterErrorText } from '../error-text';
import { runHandlerChain } from '../handler-chain';
import { JetStreamServer } from '../jetstream.server';

const PATTERN = 'TEST.failed';
const original = new SyntaxError('payload shape changed');

@Controller()
class FailingConsumer {
  @EventPattern(PATTERN)
  onFailed(): never {
    throw original;
  }
}

@Module({ controllers: [FailingConsumer] })
class FailingModule {}

describe('connectJetStreamMicroservice', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('should hand the server the original error a consumer threw, not Nest generic text', async () => {
    const registered = new Map<string, MessageHandler>();
    vi.spyOn(JetStreamServer.prototype, 'addHandler').mockImplementation((pattern, callback) => {
      registered.set(String(pattern), callback);
    });
    app = await NestFactory.create(FailingModule, { logger: false });

    connectJetStreamMicroservice(app, { servers: ['nats://unused:4222'], streams: [] });

    const handler = registered.get(PATTERN);
    assert(handler);
    const delivery = runHandlerChain([handler], {}, {});
    await expect(delivery).rejects.toBe(original);
    await expect(delivery.catch(deadLetterErrorText)).resolves.toBe(
      'SyntaxError: payload shape changed',
    );
  });
});
