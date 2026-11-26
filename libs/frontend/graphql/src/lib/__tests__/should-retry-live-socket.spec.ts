import { describe, expect, it } from 'vitest';
import { shouldRetryLiveSocket } from '../client';
import { LiveSessionEndedError } from '../ws-ticket';

describe('shouldRetryLiveSocket', () => {
  it('does not retry once the session ended', () => {
    expect(shouldRetryLiveSocket(new LiveSessionEndedError())).toBe(false);
  });

  it('retries a dropped socket and any other error', () => {
    expect(shouldRetryLiveSocket({ code: 1006, reason: '' })).toBe(true);
    expect(shouldRetryLiveSocket({ code: 4403, reason: 'Forbidden' })).toBe(true);
    expect(shouldRetryLiveSocket(new Error('network'))).toBe(true);
  });
});
