import { afterEach, describe, expect, it, vi } from 'vitest';
import { E2E_SESSION_PREFIX, restoreCapturedSession } from '../e2e/shared/auth-helpers';

function storage(initial: Record<string, string>) {
  const values = { ...initial };
  return Object.assign(values, {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
    removeItem: (key: string) => {
      delete values[key];
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('captured E2E sessions', () => {
  const key = 'roviq-institute-access-token';
  it('restores once and preserves tokens from later institute switches', () => {
    const local = storage({ [`${E2E_SESSION_PREFIX}${key}`]: 'original', preference: 'keep' });
    const session = storage({});
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    restoreCapturedSession(E2E_SESSION_PREFIX);
    expect(session.getItem(key)).toBe('original');
    expect(local.getItem(`${E2E_SESSION_PREFIX}${key}`)).toBeNull();
    session.setItem(key, 'switched');
    restoreCapturedSession(E2E_SESSION_PREFIX);
    expect(session.getItem(key)).toBe('switched');
    session.removeItem(key);
    restoreCapturedSession(E2E_SESSION_PREFIX);
    expect(session.getItem(key)).toBeNull();
    expect(local.getItem('preference')).toBe('keep');
  });
  it('preserves an existing session when consuming a saved snapshot', () => {
    vi.stubGlobal('localStorage', storage({ [`${E2E_SESSION_PREFIX}${key}`]: 'original' }));
    const session = storage({ [key]: 'current' });
    vi.stubGlobal('sessionStorage', session);
    restoreCapturedSession(E2E_SESSION_PREFIX);
    expect(session.getItem(key)).toBe('current');
  });
});
