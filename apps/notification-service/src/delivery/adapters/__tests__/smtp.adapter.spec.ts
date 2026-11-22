import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChannelAdapterError } from '../channel-adapter';
import { SmtpEmailAdapter, type SmtpLimits } from '../smtp.adapter';

const MESSAGE = {
  channel: 'EMAIL',
  type: 'FEE_REMINDER',
  recipientUserId: 'user-1',
  to: ['guardian@example.in'],
  subject: 'Fee reminder',
  body: 'Body',
  data: {},
} as const;

const SHORT: SmtpLimits = {
  connectionTimeoutMs: 5_000,
  greetingTimeoutMs: 200,
  socketTimeoutMs: 5_000,
  sendDeadlineMs: 5_000,
};

// A local server that accepts the connection and never answers, like a hung SMTP server.
describe('SmtpEmailAdapter against a silent server', () => {
  let server: Server;
  let port = 0;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    server = createServer((socket) => {
      sockets.push(socket);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no TCP address');
    port = address.port;
  });

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function codeOf(limits: SmtpLimits): Promise<string> {
    const adapter = new SmtpEmailAdapter(`smtp://127.0.0.1:${port}`, 'Roviq <a@b.in>', limits);
    try {
      await adapter.send(MESSAGE);
    } catch (err) {
      if (err instanceof ChannelAdapterError) return err.code;
      throw err;
    } finally {
      adapter.close();
    }
    throw new Error('send did not fail');
  }

  it('should fail with ETIMEDOUT when the greeting never comes', async () => {
    await expect(codeOf(SHORT)).resolves.toBe('ETIMEDOUT');
  });

  it('should fail with EABORT when the whole send outlives its deadline', async () => {
    await expect(codeOf({ ...SHORT, greetingTimeoutMs: 5_000, sendDeadlineMs: 200 })).resolves.toBe(
      'EABORT',
    );
  });
});
