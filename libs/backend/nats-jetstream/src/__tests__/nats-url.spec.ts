import { describe, expect, it } from 'vitest';
import { natsServerOptions } from '../nats-url';

describe('natsServerOptions', () => {
  it('should leave a URL without credentials as it is', () => {
    expect(natsServerOptions('nats://localhost:4222')).toEqual({
      servers: 'nats://localhost:4222',
    });
  });

  it('should take the user and password out of the URL', () => {
    expect(natsServerOptions('nats://gateway:s3cret@nats:4222')).toEqual({
      servers: 'nats://nats:4222',
      user: 'gateway',
      pass: 's3cret',
    });
  });

  it('should decode percent-encoded credentials', () => {
    expect(natsServerOptions('nats://svc:p%40ss%3Aword@nats:4222')).toMatchObject({
      user: 'svc',
      pass: 'p@ss:word',
    });
  });

  it('should keep a list a list and use the first credentials it finds', () => {
    expect(natsServerOptions(['nats://a:4222', 'nats://u:p@b:4222'])).toEqual({
      servers: ['nats://a:4222', 'nats://b:4222'],
      user: 'u',
      pass: 'p',
    });
  });

  it('should accept an address without a scheme', () => {
    expect(natsServerOptions('u:p@nats:4222')).toEqual({
      servers: 'nats:4222',
      user: 'u',
      pass: 'p',
    });
  });
});
