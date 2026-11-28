import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { applyTrustProxy } from '../trust-proxy';

describe('applyTrustProxy', () => {
  it('should leave Express alone when no proxy is declared', () => {
    const app = { set: vi.fn() };

    expect(applyTrustProxy(app, new ConfigService({}))).toBe(0);
    expect(applyTrustProxy(app, new ConfigService({ TRUST_PROXY_HOPS: '0' }))).toBe(0);
    expect(app.set).not.toHaveBeenCalled();
  });

  it('should pass the hop count, as a number, to Express', () => {
    const app = { set: vi.fn() };

    applyTrustProxy(app, new ConfigService({ TRUST_PROXY_HOPS: '2' }));

    expect(app.set).toHaveBeenCalledWith('trust proxy', 2);
  });
});
