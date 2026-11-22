import assert from 'node:assert';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { assertConsistentExtras, type ChainHandler, runHandlerChain } from '../handler-chain';
import { JetStreamServer } from '../jetstream.server';

type Ctx = { id: string };
const CTX: Ctx = { id: 'ctx' };

function handler(fn: (data: unknown, ctx: Ctx) => unknown, extras?: Record<string, unknown>) {
  const h: ChainHandler<Ctx> = (data, ctx) => fn(data, ctx);
  if (extras) h.extras = extras;
  return h;
}

describe('runHandlerChain', () => {
  it('should run every handler with the payload, one after another in registration order', async () => {
    const events: string[] = [];
    const first = handler(async (data) => {
      events.push(`first:start:${JSON.stringify(data)}`);
      await Promise.resolve();
      events.push('first:end');
    });
    const second = handler((data, ctx) => {
      events.push(`second:${JSON.stringify(data)}:${ctx.id}`);
      return of('done');
    });

    await runHandlerChain([first, second], { n: 1 }, CTX);

    expect(events).toEqual(['first:start:{"n":1}', 'first:end', 'second:{"n":1}:ctx']);
  });

  it('should fail and skip later handlers when an earlier handler rejects', async () => {
    const events: string[] = [];
    const failing = handler(async () => {
      throw new Error('boom');
    });
    const later = handler(() => {
      events.push('later');
    });

    await expect(runHandlerChain([failing, later], {}, CTX)).rejects.toThrow('boom');
    expect(events).toEqual([]);
  });

  it('should fail when a handler returns an erroring Observable (Nest RPC exception filter)', async () => {
    const filtered = handler(async () =>
      throwError(() => ({ status: 'error', message: 'Internal server error' })),
    );

    await expect(runHandlerChain([filtered], {}, CTX)).rejects.toThrow('Internal server error');
  });

  it('should keep an Error emitted by an Observable as is', async () => {
    const original = new Error('validation failed');
    const filtered = handler(() => throwError(() => original));

    await expect(runHandlerChain([filtered], {}, CTX)).rejects.toBe(original);
  });

  it('should succeed for an Observable that completes without a value', async () => {
    const empty = handler(() => of());

    await expect(runHandlerChain([empty], {}, CTX)).resolves.toBeUndefined();
  });
});

describe('assertConsistentExtras', () => {
  it('should accept handlers whose extras match regardless of key order', () => {
    const a = handler(() => undefined, { stream: 'SECTION', durable: 'gateway-section-deleted' });
    const b = handler(() => undefined, { durable: 'gateway-section-deleted', stream: 'SECTION' });

    expect(() => assertConsistentExtras('SECTION.deleted', [a, b])).not.toThrow();
  });

  it('should name the pattern and both values when extras differ', () => {
    const a = handler(() => undefined, { stream: 'SECTION', durable: 'gateway-section-deleted' });
    const b = handler(() => undefined, { stream: 'SECTION', durable: 'other', maxDeliver: 9 });

    expect(() => assertConsistentExtras('SECTION.deleted', [a, b])).toThrow(
      'Handlers for "SECTION.deleted" declare different consumer options: ' +
        '{"durable":"gateway-section-deleted","stream":"SECTION"} vs ' +
        '{"durable":"other","maxDeliver":9,"stream":"SECTION"}',
    );
  });

  it('should treat a handler without extras as different from one with extras', () => {
    const a = handler(() => undefined);
    const b = handler(() => undefined, { ackWait: 60_000 });

    expect(() => assertConsistentExtras('X.y', [a, b])).toThrow('"X.y"');
  });
});

describe('JetStreamServer.addHandler', () => {
  function makeServer(): JetStreamServer {
    return new JetStreamServer({ servers: ['nats://localhost:4222'], streams: [] });
  }

  it('should keep every event handler of a pattern in order without linking them through next', () => {
    const server = makeServer();
    const first = async () => 'first';
    const second = async () => 'second';

    server.addHandler('SECTION.deleted', first, true, { durable: 'd' });
    server.addHandler('SECTION.deleted', second, true, { durable: 'd' });

    const head = server.getHandlers().get('SECTION.deleted');
    assert(head);
    expect(server.getHandlers().size).toBe(1);
    expect(head.next).toBeUndefined();
    expect(server.handlerChainFor('SECTION.deleted', head)).toEqual([first, second]);
  });

  it('should keep separate patterns separate', () => {
    const server = makeServer();
    const a = async () => 'a';
    const b = async () => 'b';

    server.addHandler('A.x', a, true);
    server.addHandler('B.y', b, true);

    const headA = server.getHandlers().get('A.x');
    assert(headA);
    expect(server.handlerChainFor('A.x', headA)).toEqual([a]);
  });
});
